// Package statements extracts credit card statement data from bank PDFs and
// reconciles it against the movements already recorded in budg.
//
// Everything runs in-process: statement contents are never sent to an
// external service, persisted, or logged. Callers hand in the raw PDF bytes
// and receive structured data back.
package statements

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ledongthuc/pdf"
)

// MaxPDFBytes bounds the size of an uploaded statement. Real bank statements
// are well under 1 MiB; the cap keeps a hostile upload from exhausting memory.
const MaxPDFBytes = 4 << 20

// maxPages and maxTokens bound parser work on a single document; real
// statements stay far below both.
const (
	maxPages  = 40
	maxTokens = 100_000
)

// parseBudget bounds the wall-clock time of one extraction. It is checked
// between pages and rows; the PDF library itself is not interruptible.
const parseBudget = 8 * time.Second

// parseSlots limits concurrent parses so a hostile document can occupy at
// most this many workers, even if the library never returns.
var parseSlots = make(chan struct{}, 2)

var (
	// ErrNotPDF means the payload is not a PDF document.
	ErrNotPDF = errors.New("payload is not a pdf document")
	// ErrUnreadablePDF means the PDF could not be parsed or has no text layer.
	ErrUnreadablePDF = errors.New("pdf could not be read")
	// ErrUnsupportedStatement means no parser recognized the document.
	ErrUnsupportedStatement = errors.New("unsupported statement format")
	// ErrParserBusy means every parse slot is in use.
	ErrParserBusy = errors.New("statement parser is busy")
	// ErrParseTimeout means extraction exceeded its time budget.
	ErrParseTimeout = errors.New("statement parsing timed out")
)

// ExtractTokens returns the text fragments of every page in content-stream
// order, trimmed and with empty fragments removed. The PDF library can panic
// on malformed input, so panics are converted into ErrUnreadablePDF.
func ExtractTokens(data []byte) (tokens []string, err error) {
	if len(data) == 0 || len(data) > MaxPDFBytes {
		return nil, ErrNotPDF
	}
	if !bytes.HasPrefix(data, []byte("%PDF-")) {
		return nil, ErrNotPDF
	}

	defer func() {
		if recovered := recover(); recovered != nil {
			tokens = nil
			err = ErrUnreadablePDF
		}
	}()

	reader, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, ErrUnreadablePDF
	}
	pages := reader.NumPage()
	if pages <= 0 || pages > maxPages {
		return nil, ErrUnreadablePDF
	}

	deadline := time.Now().Add(parseBudget)
	for i := 1; i <= pages; i++ {
		if time.Now().After(deadline) {
			return nil, ErrParseTimeout
		}
		page := reader.Page(i)
		if page.V.IsNull() {
			continue
		}
		rows, rowErr := page.GetTextByRow()
		if rowErr != nil {
			return nil, fmt.Errorf("%w: page %d", ErrUnreadablePDF, i)
		}
		for _, row := range rows {
			if time.Now().After(deadline) {
				return nil, ErrParseTimeout
			}
			for _, text := range row.Content {
				if token := normalizeToken(text.S); token != "" {
					tokens = append(tokens, token)
				}
			}
			if len(tokens) > maxTokens {
				return nil, ErrUnreadablePDF
			}
		}
	}
	if len(tokens) == 0 {
		return nil, ErrUnreadablePDF
	}
	return tokens, nil
}

// normalizeToken trims a fragment and collapses internal runs of whitespace.
func normalizeToken(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// Parse extracts tokens from a PDF and runs the first parser that recognizes
// the document.
func Parse(data []byte) (Statement, error) {
	tokens, err := ExtractTokens(data)
	if err != nil {
		return Statement{}, err
	}
	return ParseTokens(tokens)
}

// ParseContext runs Parse in a bounded worker slot and stops waiting when ctx
// ends. A parse that outlives ctx keeps its slot until it finishes, which caps
// the damage a pathological document can do to the process.
func ParseContext(ctx context.Context, data []byte) (Statement, error) {
	select {
	case parseSlots <- struct{}{}:
	default:
		return Statement{}, ErrParserBusy
	}

	type outcome struct {
		statement Statement
		err       error
	}
	done := make(chan outcome, 1)
	go func() {
		defer func() { <-parseSlots }()
		defer func() {
			if recovered := recover(); recovered != nil {
				done <- outcome{err: ErrUnreadablePDF}
			}
		}()
		statement, err := Parse(data)
		done <- outcome{statement, err}
	}()

	select {
	case result := <-done:
		return result.statement, result.err
	case <-ctx.Done():
		return Statement{}, ErrParseTimeout
	}
}

// ParseTokens runs the first parser that recognizes the token stream.
func ParseTokens(raw []string) (Statement, error) {
	tokens := make([]string, 0, len(raw))
	for _, token := range raw {
		if normalized := normalizeToken(token); normalized != "" {
			tokens = append(tokens, normalized)
		}
	}
	if isBanamexCreditCard(tokens) {
		return parseBanamexCreditCard(tokens)
	}
	return Statement{}, ErrUnsupportedStatement
}
