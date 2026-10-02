package statements

import (
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/aleonsa/budg/backend/internal/store"
)

// MatchStatus describes how a statement movement relates to budg data.
type MatchStatus string

const (
	// StatusMatched means an existing transaction already records the movement.
	StatusMatched MatchStatus = "matched"
	// StatusMissing means no transaction records it; the client may create one.
	StatusMissing MatchStatus = "missing"
	// StatusInstallmentMatched means a deferred-purchase installment matched
	// a scheduled MSI installment in budg.
	StatusInstallmentMatched MatchStatus = "installment_matched"
	// StatusInstallmentUnmatched means an installment has no scheduled MSI
	// counterpart. It is informational: installments are managed through MSI
	// purchases, never created as standalone expenses.
	StatusInstallmentUnmatched MatchStatus = "installment_unmatched"
)

const (
	regularWindowDays     = 3
	installmentWindowDays = 20
	installmentToleranceC = 2
)

// MovementResult pairs a statement movement with its reconciliation outcome.
type MovementResult struct {
	Movement
	Status        MatchStatus `json:"status"`
	TransactionID *string     `json:"transactionId"`
}

// TransactionRef is the minimal view of a budg transaction returned to the
// client for movements that only exist in budg.
type TransactionRef struct {
	ID            string  `json:"id"`
	Date          string  `json:"date"`
	Type          string  `json:"type"`
	Description   string  `json:"description"`
	AmountCents   int64   `json:"amount"`
	MSIPurchaseID *string `json:"msiPurchaseId,omitempty"`
}

// Summary aggregates reconciliation counts.
type Summary struct {
	Matched               int   `json:"matched"`
	Missing               int   `json:"missing"`
	InstallmentsMatched   int   `json:"installmentsMatched"`
	InstallmentsUnmatched int   `json:"installmentsUnmatched"`
	OnlyInBudg            int   `json:"onlyInBudg"`
	MissingChargesCents   int64 `json:"missingCharges"`
	MissingCreditsCents   int64 `json:"missingCredits"`
}

// Reconciliation is the full comparison between a statement and an account.
type Reconciliation struct {
	Statement  StatementHeader  `json:"statement"`
	Movements  []MovementResult `json:"movements"`
	OnlyInBudg []TransactionRef `json:"onlyInBudg"`
	Summary    Summary          `json:"summary"`
}

// StatementHeader is a Statement without its movement list.
type StatementHeader struct {
	Issuer                      string   `json:"issuer"`
	Product                     string   `json:"product"`
	CardLast4                   string   `json:"cardLast4"`
	PeriodStart                 string   `json:"periodStart"`
	PeriodEnd                   string   `json:"periodEnd"`
	PaymentDueDate              string   `json:"paymentDueDate"`
	PaymentToAvoidInterestCents int64    `json:"paymentToAvoidInterest"`
	MinimumPaymentCents         *int64   `json:"minimumPayment"`
	TotalChargesCents           int64    `json:"totalCharges"`
	TotalCreditsCents           int64    `json:"totalCredits"`
	Warnings                    []string `json:"warnings"`
}

// Reconcile matches statement movements against transactions of accountID.
// It is deterministic and side-effect free: each transaction matches at most
// one movement, assigned globally by closest date and description similarity.
func Reconcile(st Statement, accountID string, transactions []store.Transaction) Reconciliation {
	result := Reconciliation{
		Statement:  headerOf(st),
		Movements:  make([]MovementResult, 0, len(st.Movements)),
		OnlyInBudg: []TransactionRef{},
	}

	relevant := make([]store.Transaction, 0)
	for _, tx := range transactions {
		if touchesAccount(tx, accountID) {
			relevant = append(relevant, tx)
		}
	}
	assignment := assignMatches(st.Movements, accountID, relevant)
	used := make(map[string]bool, len(assignment))

	for index, movement := range st.Movements {
		outcome := MovementResult{Movement: movement}
		txIndex, matched := assignment[index]
		switch {
		case matched && movement.Installment != nil:
			outcome.Status = StatusInstallmentMatched
		case matched:
			outcome.Status = StatusMatched
		case movement.Installment != nil:
			outcome.Status = StatusInstallmentUnmatched
		default:
			outcome.Status = StatusMissing
		}
		if matched {
			id := relevant[txIndex].ID
			used[id] = true
			outcome.TransactionID = &id
		}
		result.Movements = append(result.Movements, outcome)

		switch outcome.Status {
		case StatusMatched:
			result.Summary.Matched++
		case StatusInstallmentMatched:
			result.Summary.InstallmentsMatched++
		case StatusInstallmentUnmatched:
			result.Summary.InstallmentsUnmatched++
		case StatusMissing:
			result.Summary.Missing++
			if movement.Direction == DirectionCharge {
				result.Summary.MissingChargesCents += movement.AmountCents
			} else {
				result.Summary.MissingCreditsCents += movement.AmountCents
			}
		}
	}

	for _, tx := range relevant {
		if used[tx.ID] || tx.Date < st.PeriodStart || tx.Date > st.PeriodEnd {
			continue
		}
		result.OnlyInBudg = append(result.OnlyInBudg, TransactionRef{
			ID: tx.ID, Date: tx.Date, Type: tx.Type, Description: tx.Description,
			AmountCents: tx.Amount, MSIPurchaseID: tx.MSIPurchaseID,
		})
	}
	sort.SliceStable(result.OnlyInBudg, func(i, j int) bool {
		return result.OnlyInBudg[i].Date < result.OnlyInBudg[j].Date
	})
	result.Summary.OnlyInBudg = len(result.OnlyInBudg)
	return result
}

func headerOf(st Statement) StatementHeader {
	warnings := st.Warnings
	if warnings == nil {
		warnings = []string{}
	}
	return StatementHeader{
		Issuer: st.Issuer, Product: st.Product, CardLast4: st.CardLast4,
		PeriodStart: st.PeriodStart, PeriodEnd: st.PeriodEnd, PaymentDueDate: st.PaymentDueDate,
		PaymentToAvoidInterestCents: st.PaymentToAvoidInterestCents,
		MinimumPaymentCents:         st.MinimumPaymentCents,
		TotalChargesCents:           st.TotalChargesCents,
		TotalCreditsCents:           st.TotalCreditsCents,
		Warnings:                    warnings,
	}
}

func touchesAccount(tx store.Transaction, accountID string) bool {
	return tx.AccountID == accountID || (tx.TransferToAccount != nil && *tx.TransferToAccount == accountID)
}

// eligible reports whether tx can record movement from the card's
// perspective: charges are card expenses or transfers out of the card;
// credits are card income (refunds) or transfers into the card (payments).
func eligible(movement Movement, accountID string, tx store.Transaction) bool {
	if movement.Installment != nil {
		return tx.MSIPurchaseID != nil && tx.AccountID == accountID && tx.Type == "expense" &&
			absInt64(tx.Amount-movement.AmountCents) <= installmentToleranceC
	}
	if tx.MSIPurchaseID != nil || tx.Amount != movement.AmountCents {
		return false
	}
	if movement.Direction == DirectionCharge {
		return tx.AccountID == accountID && (tx.Type == "expense" || tx.Type == "transfer")
	}
	if tx.Type == "transfer" {
		return tx.TransferToAccount != nil && *tx.TransferToAccount == accountID
	}
	return tx.AccountID == accountID && tx.Type == "income"
}

// candidatePair is one eligible (movement, transaction) combination.
type candidatePair struct {
	movement, transaction int
	distance, overlap     int
}

// assignMatches pairs movements with transactions globally: every eligible
// pair is ranked by date distance, then description overlap, then statement
// order, and assigned greedily so a movement never steals a closer match that
// another movement needed. Each side is used at most once.
func assignMatches(movements []Movement, accountID string, txs []store.Transaction) map[int]int {
	pairs := make([]candidatePair, 0)
	for mi, movement := range movements {
		from, to, ok := movementWindow(movement)
		if !ok {
			continue
		}
		for ti, tx := range txs {
			if !eligible(movement, accountID, tx) {
				continue
			}
			date, err := time.Parse("2006-01-02", tx.Date)
			if err != nil || date.Before(from) || date.After(to) {
				continue
			}
			pairs = append(pairs, candidatePair{
				movement:    mi,
				transaction: ti,
				distance:    dayDistance(date, movement),
				overlap:     descriptionOverlap(movement.Description, tx.Description, tx.Merchant),
			})
		}
	}
	sort.SliceStable(pairs, func(i, j int) bool {
		a, b := pairs[i], pairs[j]
		if a.distance != b.distance {
			return a.distance < b.distance
		}
		if a.overlap != b.overlap {
			return a.overlap > b.overlap
		}
		if a.movement != b.movement {
			return a.movement < b.movement
		}
		return a.transaction < b.transaction
	})

	assignment := make(map[int]int)
	usedTx := make(map[int]bool)
	for _, pair := range pairs {
		if _, taken := assignment[pair.movement]; taken || usedTx[pair.transaction] {
			continue
		}
		assignment[pair.movement] = pair.transaction
		usedTx[pair.transaction] = true
	}
	return assignment
}

func movementWindow(movement Movement) (time.Time, time.Time, bool) {
	operation, err := time.Parse("2006-01-02", movement.OperationDate)
	if err != nil {
		return time.Time{}, time.Time{}, false
	}
	posting, err := time.Parse("2006-01-02", movement.PostingDate)
	if err != nil {
		return time.Time{}, time.Time{}, false
	}
	if posting.Before(operation) {
		operation, posting = posting, operation
	}
	window := regularWindowDays
	if movement.Installment != nil {
		window = installmentWindowDays
	}
	return operation.AddDate(0, 0, -window), posting.AddDate(0, 0, window), true
}

// dayDistance is the number of days from date to the nearest of the
// movement's operation and posting dates (zero when between them).
func dayDistance(date time.Time, movement Movement) int {
	operation, _ := time.Parse("2006-01-02", movement.OperationDate)
	posting, _ := time.Parse("2006-01-02", movement.PostingDate)
	if posting.Before(operation) {
		operation, posting = posting, operation
	}
	switch {
	case date.Before(operation):
		return int(operation.Sub(date).Hours() / 24)
	case date.After(posting):
		return int(date.Sub(posting).Hours() / 24)
	default:
		return 0
	}
}

func descriptionOverlap(statementText, description string, merchant *string) int {
	words := significantWords(statementText)
	if len(words) == 0 {
		return 0
	}
	candidate := description
	if merchant != nil {
		candidate += " " + *merchant
	}
	overlap := 0
	for word := range significantWords(candidate) {
		if words[word] {
			overlap++
		}
	}
	return overlap
}

func significantWords(text string) map[string]bool {
	words := map[string]bool{}
	for _, field := range strings.FieldsFunc(strings.ToUpper(text), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		if len([]rune(field)) >= 3 {
			words[field] = true
		}
	}
	return words
}

func absInt64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}
