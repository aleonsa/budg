package statements

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Statement is the normalized content of a credit card statement.
type Statement struct {
	Issuer                      string     `json:"issuer"`
	Product                     string     `json:"product"`
	CardLast4                   string     `json:"cardLast4"`
	PeriodStart                 string     `json:"periodStart"`
	PeriodEnd                   string     `json:"periodEnd"`
	PaymentDueDate              string     `json:"paymentDueDate"`
	PaymentToAvoidInterestCents int64      `json:"paymentToAvoidInterest"`
	MinimumPaymentCents         *int64     `json:"minimumPayment"`
	TotalChargesCents           int64      `json:"totalCharges"`
	TotalCreditsCents           int64      `json:"totalCredits"`
	Movements                   []Movement `json:"movements"`
	Warnings                    []string   `json:"warnings"`
}

// Direction is the effect of a movement on the card balance.
type Direction string

const (
	DirectionCharge Direction = "charge"
	DirectionCredit Direction = "credit"
)

// Installment identifies a monthly charge of a deferred purchase or loan.
type Installment struct {
	Number int `json:"number"`
	Total  int `json:"total"`
}

// Movement is one line of the regular movements table.
type Movement struct {
	Line          int          `json:"line"`
	OperationDate string       `json:"operationDate"`
	PostingDate   string       `json:"postingDate"`
	Description   string       `json:"description"`
	AmountCents   int64        `json:"amount"`
	Direction     Direction    `json:"direction"`
	Installment   *Installment `json:"installment,omitempty"`
}

// Warning codes surfaced to the client.
const (
	WarningChargesTotalMismatch = "charges_total_mismatch"
	WarningCreditsTotalMismatch = "credits_total_mismatch"
	WarningMissingTotals        = "missing_totals"
	WarningCardLast4Mismatch    = "card_last4_mismatch"
)

var (
	statementDatePattern = regexp.MustCompile(`(?i)^(\d{1,2})-([a-z]{3,4})-(\d{4})$`)
	embeddedDatePattern  = regexp.MustCompile(`(?i)(\d{1,2})-([a-z]{3,4})-(\d{4})`)
	moneyPattern         = regexp.MustCompile(`^([+-])?\s*\$?\s*(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$`)
	installmentPattern   = regexp.MustCompile(`^(.*?)\s+(\d{1,3}) de (\d{1,3})$`)
	cardNumberPattern    = regexp.MustCompile(`^[\d ]{12,23}$`)
)

var spanishMonths = map[string]time.Month{
	"ene": time.January, "feb": time.February, "mar": time.March,
	"abr": time.April, "may": time.May, "jun": time.June,
	"jul": time.July, "ago": time.August, "sep": time.September,
	"sept": time.September, "set": time.September, "oct": time.October,
	"nov": time.November, "dic": time.December,
}

func isBanamexCreditCard(tokens []string) bool {
	var issuer, creditCard bool
	for _, token := range tokens {
		upper := strings.ToUpper(token)
		if strings.Contains(upper, "BANAMEX") {
			issuer = true
		}
		if strings.HasPrefix(upper, "TARJETA DE CRÉDITO") || strings.HasPrefix(upper, "TARJETA DE CREDITO") {
			creditCard = true
		}
		if issuer && creditCard {
			return true
		}
	}
	return false
}

func parseBanamexCreditCard(tokens []string) (Statement, error) {
	st := Statement{Issuer: "banamex", Movements: []Movement{}, Warnings: []string{}}
	var haveCharges, haveCredits, haveCut, havePaymentToAvoidInterest bool

	for i, token := range tokens {
		switch {
		case st.Product == "" && strings.EqualFold(token, "Tarjeta de Crédito") && i+1 < len(tokens):
			if strings.Contains(strings.ToUpper(tokens[i+1]), "BANAMEX") {
				st.Product = tokens[i+1]
			}
		case token == "Periodo:" && st.PeriodStart == "":
			if i+1 < len(tokens) {
				dates := embeddedDatePattern.FindAllString(tokens[i+1], 2)
				if len(dates) == 2 {
					st.PeriodStart, _ = parseStatementDate(dates[0])
					st.PeriodEnd, _ = parseStatementDate(dates[1])
				}
			}
		case token == "Fecha de corte:" && !haveCut && i+1 < len(tokens):
			if end, ok := parseStatementDate(tokens[i+1]); ok {
				st.PeriodEnd, haveCut = end, true
			}
		case strings.HasPrefix(token, "Fecha límite de pago") && st.PaymentDueDate == "":
			st.PaymentDueDate = findEmbeddedDate(tokens, i+1, 3)
		case strings.HasPrefix(token, "Pago para no generar intereses") && !havePaymentToAvoidInterest:
			if cents, ok := findMoney(tokens, i+1, 3); ok {
				st.PaymentToAvoidInterestCents, havePaymentToAvoidInterest = cents, true
			}
		case token == "Pago mínimo:" && st.MinimumPaymentCents == nil:
			if cents, ok := findMoney(tokens, i+1, 3); ok {
				st.MinimumPaymentCents = &cents
			}
		case strings.HasPrefix(token, "Número de tarjeta") && st.CardLast4 == "":
			st.CardLast4 = findCardLast4(token, tokens, i+1)
		case token == "Total cargos" && !haveCharges:
			if cents, ok := findMoney(tokens, i+1, 2); ok {
				st.TotalChargesCents, haveCharges = cents, true
			}
		case token == "Total abonos" && !haveCredits:
			if cents, ok := findMoney(tokens, i+1, 2); ok {
				st.TotalCreditsCents, haveCredits = cents, true
			}
		}
	}

	st.Movements = parseBanamexMovements(tokens)

	if st.PeriodStart == "" || st.PeriodEnd == "" || st.PaymentDueDate == "" {
		return Statement{}, fmt.Errorf("%w: missing statement period or payment due date", ErrUnsupportedStatement)
	}

	var charges, credits int64
	for _, movement := range st.Movements {
		if movement.Direction == DirectionCharge {
			charges += movement.AmountCents
		} else {
			credits += movement.AmountCents
		}
	}
	switch {
	case !haveCharges || !haveCredits:
		st.Warnings = append(st.Warnings, WarningMissingTotals)
	default:
		if charges != st.TotalChargesCents {
			st.Warnings = append(st.Warnings, WarningChargesTotalMismatch)
		}
		if credits != st.TotalCreditsCents {
			st.Warnings = append(st.Warnings, WarningCreditsTotalMismatch)
		}
	}
	return st, nil
}

// parseBanamexMovements scans for the regular-movements row shape:
// operation date, posting date, description fragments, sign, amount. Deferred
// purchase tables carry a single date per row, so they never match.
func parseBanamexMovements(tokens []string) []Movement {
	movements := []Movement{}
	for i := 0; i+3 < len(tokens); i++ {
		operation, ok := parseStatementDate(tokens[i])
		if !ok {
			continue
		}
		posting, ok := parseStatementDate(tokens[i+1])
		if !ok {
			continue
		}

		var description []string
		j := i + 2
		var direction Direction
		var amount int64
		matched := false
		for ; j < len(tokens) && j <= i+8; j++ {
			token := tokens[j]
			if token == "+" || token == "-" || token == "−" {
				if j+1 < len(tokens) {
					if cents, sign, ok := parseMoney(tokens[j+1]); ok && sign == "" {
						direction, amount, matched = signDirection(token), cents, true
						j++
					}
				}
				break
			}
			if cents, sign, ok := parseMoney(token); ok && sign != "" {
				direction, amount, matched = signDirection(sign), cents, true
				break
			}
			if _, ok := parseStatementDate(token); ok {
				break
			}
			description = append(description, token)
		}
		if !matched || len(description) == 0 || amount <= 0 {
			continue
		}

		movement := Movement{
			Line:          len(movements) + 1,
			OperationDate: operation,
			PostingDate:   posting,
			Description:   strings.Join(description, " "),
			AmountCents:   amount,
			Direction:     direction,
		}
		if parts := installmentPattern.FindStringSubmatch(movement.Description); parts != nil {
			number, _ := strconv.Atoi(parts[2])
			total, _ := strconv.Atoi(parts[3])
			if number >= 1 && total >= number && strings.TrimSpace(parts[1]) != "" {
				movement.Description = strings.TrimSpace(parts[1])
				movement.Installment = &Installment{Number: number, Total: total}
			}
		}
		movements = append(movements, movement)
		i = j
	}
	return movements
}

func signDirection(sign string) Direction {
	if sign == "-" || sign == "−" {
		return DirectionCredit
	}
	return DirectionCharge
}

// parseStatementDate converts "05-jun-2026" into "2026-06-05".
func parseStatementDate(token string) (string, bool) {
	parts := statementDatePattern.FindStringSubmatch(strings.TrimSpace(token))
	if parts == nil {
		return "", false
	}
	return buildDate(parts[1], parts[2], parts[3])
}

func buildDate(dayText, monthText, yearText string) (string, bool) {
	month, ok := spanishMonths[strings.ToLower(monthText)]
	if !ok {
		return "", false
	}
	day, err := strconv.Atoi(dayText)
	if err != nil {
		return "", false
	}
	year, err := strconv.Atoi(yearText)
	if err != nil || year < 1900 || year > 2999 {
		return "", false
	}
	date := time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
	if date.Day() != day || date.Month() != month {
		return "", false
	}
	return date.Format("2006-01-02"), true
}

func findEmbeddedDate(tokens []string, start, window int) string {
	for i := start; i < len(tokens) && i < start+window; i++ {
		if parts := embeddedDatePattern.FindStringSubmatch(tokens[i]); parts != nil {
			if date, ok := buildDate(parts[1], parts[2], parts[3]); ok {
				return date
			}
		}
	}
	return ""
}

func findMoney(tokens []string, start, window int) (int64, bool) {
	for i := start; i < len(tokens) && i < start+window; i++ {
		if cents, _, ok := parseMoney(tokens[i]); ok {
			return cents, true
		}
	}
	return 0, false
}

func findCardLast4(label string, tokens []string, start int) string {
	candidates := []string{strings.TrimPrefix(strings.TrimPrefix(label, "Número de tarjeta"), ":")}
	if start < len(tokens) {
		candidates = append(candidates, tokens[start])
	}
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if !cardNumberPattern.MatchString(candidate) {
			continue
		}
		digits := strings.ReplaceAll(candidate, " ", "")
		if len(digits) >= 12 {
			return digits[len(digits)-4:]
		}
	}
	return ""
}

// parseMoney parses "$12,345.67", "+$12.00", or "12.00" into cents. The
// returned sign is "+", "-", or "" when absent.
func parseMoney(token string) (int64, string, bool) {
	normalized := strings.Replace(strings.TrimSpace(token), "−", "-", 1)
	parts := moneyPattern.FindStringSubmatch(normalized)
	if parts == nil {
		return 0, "", false
	}
	whole, err := strconv.ParseInt(strings.ReplaceAll(parts[2], ",", ""), 10, 64)
	if err != nil || whole > 1_000_000_000 {
		return 0, "", false
	}
	fraction, err := strconv.ParseInt(parts[3], 10, 64)
	if err != nil {
		return 0, "", false
	}
	return whole*100 + fraction, parts[1], true
}
