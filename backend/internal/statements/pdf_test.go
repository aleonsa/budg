package statements

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
)

// buildTestPDF writes a minimal single-page PDF that draws each token on its
// own line with a standard WinAnsi Helvetica font. It lets tests exercise the
// real PDF text extraction without committing any bank document.
func buildTestPDF(t *testing.T, tokens []string) []byte {
	t.Helper()
	var content bytes.Buffer
	content.WriteString("BT /F1 8 Tf 20 1960 Td 10 TL\n")
	for _, token := range tokens {
		content.WriteString("(")
		for _, r := range token {
			if r > 255 {
				t.Fatalf("token %q has a rune outside WinAnsi", token)
			}
			switch r {
			case '(', ')', '\\':
				content.WriteByte('\\')
			}
			content.WriteByte(byte(r))
		}
		content.WriteString(") Tj T*\n")
	}
	content.WriteString("ET")

	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 2000] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", content.Len(), content.String()),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
	}
	var doc bytes.Buffer
	doc.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objects))
	for i, object := range objects {
		offsets[i] = doc.Len()
		fmt.Fprintf(&doc, "%d 0 obj\n%s\nendobj\n", i+1, object)
	}
	xref := doc.Len()
	fmt.Fprintf(&doc, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, offset := range offsets {
		fmt.Fprintf(&doc, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&doc, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xref)
	return doc.Bytes()
}

func TestParseSyntheticBanamexPDFEndToEnd(t *testing.T) {
	data := buildTestPDF(t, syntheticBanamexTokens())

	st, err := ParseContext(context.Background(), data)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if st.Product != "JOY BANAMEX" || st.CardLast4 != "4321" || st.PeriodEnd != "2026-07-08" ||
		st.PaymentDueDate != "2026-08-03" || st.PaymentToAvoidInterestCents != 125050 {
		t.Fatalf("header = %+v", st)
	}
	if len(st.Movements) != 4 || len(st.Warnings) != 0 {
		t.Fatalf("movements = %d warnings = %v", len(st.Movements), st.Warnings)
	}
}

func TestParseContextRejectsWhenAllSlotsBusy(t *testing.T) {
	for i := 0; i < cap(parseSlots); i++ {
		parseSlots <- struct{}{}
	}
	defer func() {
		for i := 0; i < cap(parseSlots); i++ {
			<-parseSlots
		}
	}()
	if _, err := ParseContext(context.Background(), []byte("%PDF-1.4")); !errors.Is(err, ErrParserBusy) {
		t.Fatalf("err = %v, want ErrParserBusy", err)
	}
}

func FuzzExtractTokens(f *testing.F) {
	f.Add([]byte("%PDF-1.4\n"))
	f.Add([]byte("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>"))
	f.Add([]byte("not a pdf"))
	f.Fuzz(func(t *testing.T, data []byte) {
		tokens, err := ExtractTokens(data)
		if err == nil && len(tokens) == 0 {
			t.Fatal("success without tokens")
		}
	})
}

func FuzzParseTokens(f *testing.F) {
	f.Add(strings.Join(syntheticBanamexTokens(), "\x00"))
	f.Add("Tarjeta de Crédito\x00JOY BANAMEX\x0001-ene-2026\x0001-ene-2026\x00X\x00+\x00$1.00")
	f.Fuzz(func(t *testing.T, joined string) {
		st, err := ParseTokens(strings.Split(joined, "\x00"))
		if err != nil {
			return
		}
		for _, movement := range st.Movements {
			if movement.AmountCents <= 0 || movement.Description == "" {
				t.Fatalf("invalid movement %+v", movement)
			}
		}
	})
}
