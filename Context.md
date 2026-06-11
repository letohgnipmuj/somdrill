# Drill Checker Context
Permanent context file on everything drills and non-technical

## Overview

**What is a drill?**
Drills are timed math exercises (5 or 10 minutes) for elementary students (grades 1-7) to practice arithmetic computation. Topics include addition, subtraction, multiplication, and division with varying difficulty levels.

**Purpose**
Primarily used in an extracurricular math program to build quick mental math skills, enabling students to tackle advanced concepts with greater confidence and reduced math anxiety.

---

## How Drills Work

### Drill Structure
Each drill consists of:
- **Detached column** (left): Numbers called "generated numbers" − first argument of each calculation
- **Detached row** (top): Numbers called "numbers along the top" − second argument of each calculation
- **Main grid**: Cells where students write answers
- **Operation symbol**: Single symbol (+, −, ×, ÷) indicating drill type, positioned above generated numbers and to the left of numbers along the top

Students solve: `Generated Number [OP] Number Along Top` for each cell, proceeding column-by-column from left to right.
- Arguments can range in digits and sign (+ or -) across different types of drills, but stay consistent within each. For example, 2x2 addition or 3x1 integer multiplication.

### Drill Types

| Type | Grid Size | Duration |
|------|-----------|----------|
| Normal | 5 across × 8 down | 5 minutes |
| Long | 8 across × 10 down | 10 minutes |
| Big | N/A | 10 minutes |

### Scoring Rules
- **1 point** per correct answer, **0 points** per incorrect answer
- Column scores: sum correct answers in each column (max 8 per column for normal, max 10 for long)
- Total score: sum of all column scores (max 40 for normal, max 80 for long)
- Student marks column subtotals below each column, then final "Total" score at the bottom

---

## Visual Layout

A typical drill page contains (in visual order):
1. Drill number (top left as "Drill Number [number]")
2. Operation symbol (top left, above generated column)
3. Numbers along the top (directly above main grid)
4. Generated numbers column (directly left of main grid)
5. Main answer grid
6. "# correct" label (small, below generated numbers)
7. Subtotal blanks (one below each column, small black "_")
8. "Total __" line (below first subtotal)
9. Optional tip text (below scoring area, irrelevant for this)

**Spacing note:** Detached row/column kept 0.2−1 cm separate from main grid, usually with thicker borders for distinction.

Note: Each page can contain up to 4 "normal" (1 in each corner) or 2 "long" (top and bottom)

---

## Answer & Marking Format

### Answer Format
- Single or multi-digit integers
- In division: remainder separated by dash (e.g., "7-2" for 7 remainder 2)
- No decimals, fractions, or exponents expected

### Marking Convention
- **Correct answers**: Left unmarked
- **Incorrect answers**: Circled (typically a complete or mostly-complete circle around the box or answer itself)

---

## Implementation Constraints & Considerations

### Input & Auto-Detection
- Operation type and digit ranges **must be specified** by user — for speed and accuracy
- Drill type (normal vs. long) taken from user input

### Recognition Challenges
- Handwriting varies widely (messy to neat)
- Circles around incorrect answers vary in style and completeness
- Stray marks and paper imperfections may occur
- Camera angle, lighting, and photo quality impact OCR accuracy

### Edge Cases
- Students may skip questions: **only score consecutive questions from start**
- Multi-marking on single answer: score as incorrect (marked = wrong)
- Erased or crossed-out answers: treat as blank/unanswered
- Should be no declimals or fractions in student answers - mark as incorrect

---

## MVP Implementation Details

### Scope (Phase 1)
- **Drill types supported**: Normal drills only (5 across × 8 down grid, max score 40)
- **Long drills**: Deferred to Phase 2
- **Big drills**: Deferred to Phase 3

### User Flow
1. **Input Parameters**: User specifies operation type (+, −, ×, ÷) and digit ranges for generated numbers & numbers along top
2. **Photo Capture**: Upload or capture photo of completed drill
3. **Image Processing**: Extract grid, detect marked answers, apply OCR
4. **Initial Results**: Display all 40 individual answers with pass/fail status + column subtotals
5. **Verification**: User can correct any misread answers before finalizing score
6. **Final Score**: Display corrected column totals and total score

### Tech Stack
- **Frontend**: React + TypeScript + Vite (web app, mobile-responsive)
- **OCR**: Tesseract.js (client-side, open-source)
- **Deployment**: Mobile-accessible web app (no native apps)
- **Data**: Stateless MVP (no persistence/accounts; can add in Phase 2)

### Accuracy & Validation
- **Target accuracy**: 90% on auto-detected answers
- **Training data**: Use existing collection of marked normal drills for validation
- **Verification step**: Users review & correct errors before final submission

### Development Environment
- Windows-only development
- Fast iteration cycle prioritized
- Compromise on perfection where technically inefficient

## Future Enhancements (Out of Scope for MVP)
- Autodetection of drill type ("normal" vs "long")
- Autodetection of main operation
- Support for "Big" drills (long multiplication/division)
- Support for "long" drills (10 across x 8 down grid)
- Diagonal line detection for marking time-limit boundary
- Continued-practice detection beyond time limit
- Data persistence & user accounts
- Backend OCR processing for improved accuracy