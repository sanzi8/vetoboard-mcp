---
name: contract-review
description: Three-layer contract review and clause risk auditing (basic text accuracy, commercial terms, and legal protections). Adds structured clause-anchored comments without altering original contract text, and produces an objective contract summary, consolidated review opinion, and Mermaid business flowchart.
---

# Contract Review Skill

## Overview

This skill performs contract reviews by **adding comments only** (never editing original contract text). It follows a structured three-layer review model (basic, business, legal) and produces:

- Annotated contract (`.docx` or structured clause-by-clause review report)
- Objective contract summary
- Consolidated review opinion for business stakeholders
- Business process flowchart (Mermaid diagram + optional rendered image)

**Language rule:** Detect the contract's dominant language and write all generated comments, summaries, opinions, and flowchart labels in that language (see **[references/language.md](references/language.md)** when present).

## Workflow

1. Unpack or parse the contract document (`.docx` XML, PDF, or plain text)
2. Read the complete contract text and definitions
3. Execute the three-layer clause audit
4. Anchor structured review comments to exact clauses/paragraphs
5. Generate an objective contract summary
6. Generate a consolidated risk & negotiation opinion
7. Generate a Mermaid business flowchart directly from contractual obligations
8. Repack `.docx` (when operating on Word files) and verify comments

## Output Naming

- Output directory: `Review_Result_{ContractName}`
- Reviewed contract: `{ContractName}_Reviewed.docx`
- Review report: `Review_Report.md` (or `.txt`)

## Comment Principles

- **Comments only**: Never modify original contract wording or formatting
- **Precise anchoring**: Target specific clauses, sections, and defined terms
- **Structured content**: Every comment must state `[Issue Type]`, `[Risk Reason]`, and `[Revision Suggestion]`
- **Risk severity**: Encode severity consistently (`High` / `Medium` / `Low`)

**Comment example:**
```text
[Issue Type] Payment Terms
[Risk Reason] The total contract value is stated as USD 100,000 in Section 3.2, whereas Section 5.1 lists milestone payments totaling USD 1,000,000. This discrepancy creates immediate payment dispute exposure.
[Revision Suggestion] Reconcile the total amount across Sections 3.2 and 5.1 and explicitly specify whether applicable taxes are included.
```

## Review Standards

Apply all three layers systematically (see **[references/checklist.md](references/checklist.md)** when available):

### Layer 1: Basic (Text & Cross-Reference Quality)
- Consistency of numbers, currency figures, dates, and defined terms
- Accurate section numbering and cross-references
- Clarity and absence of syntactic ambiguity

### Layer 2: Commercial Terms
- Scope of work, deliverables, quantities, and specifications
- Pricing structure, tax treatment, and payment schedule
- Delivery, inspection, and acceptance criteria
- Rights, obligations, SLAs, and performance guarantees

### Layer 3: Legal Protections
- Effective conditions, term, renewal traps (e.g., silent auto-renewal), and termination rights
- Indemnification, liability caps, liquidated damages, and remedies
- Governing law, jurisdiction, and dispute resolution venue
- Confidentiality, force majeure, IP ownership, notices, and signatory authority

**Severity tiers:**
- 🔴 **High**: Core commercial or legal exposure (uncapped liability, pricing mismatch, IP transfer trap, missing termination right)
- 🟡 **Medium**: Material ambiguity in non-core operational procedures
- 🔵 **Low**: Minor drafting or cross-reference cleanup

## Deliverables

1. **Contract Summary** (`Contract_Summary.docx` / `.md`): Strictly objective facts (parties, scope, price, term, milestones) with zero subjective risk commentary.
2. **Consolidated Opinion** (`Consolidated_Opinion.docx` / `.md`): Concise two-paragraph executive guidance summarizing top redlines and concrete negotiation redlines.
3. **Business Flowchart** (`business_flowchart.mmd`): Mermaid `flowchart TD` derived strictly from contractual triggers, delivery gates, payment milestones, and remedies.

## Important Rules

1. Never alter original contract text
2. Audit all three layers without skipping clauses
3. Calibrate risk severity accurately and consistently
4. Make every revision suggestion concrete and redline-ready
5. Derive flowcharts strictly from written contract obligations
6. Keep the summary purely factual and keep the opinion grounded only in verified findings
