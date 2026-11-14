# Preserve rollout guards within D1 expression depth

The production diagnostic identified a commit SQL failure. Read-only EXPLAIN
of the captured four-statement batch then established the actual error:
`Expression tree is too large (maximum depth 100): SQLITE_ERROR` on the first
guard INSERT. UPDATE, event INSERT and guard DELETE compiled independently.
The successful guard SELECT was not sufficient proof that INSERT would compile.

Four outer fence groups alone still exceed the limit (independently measured
minimum depth 110, versus 128 before grouping). Retain those groups and balance
only the already separated pure AND lists in the lease/model/runtime full-row
matching generators and runtime proof fence. The small `sqlAnd` helper does not
parse SQL, drop/simplify predicates, reorder leaves, alter parameters or change
unknown-state rules. Three-valued AND remains associative for these read-only
predicates. The original atomic four-statement transaction remains unchanged.

Local native workerd/D1 reproduces maximum-depth-100 failure for the former
flat tuples and compiles the complete repaired guard using 48 null parameters
with EXPLAIN only. Independent SQLite with its depth limit explicitly set to
100 measures the repaired shape at depth 72. The actual captured 48 typed
parameters are retained in an ignored private EXPLAIN input. On 2026-11-14 at
13:56:47 UTC the operator's remote D1 EXPLAIN returned HTTP 200, success=true,
1,698 instructions and rows_written=0. The operator separately confirmed all
48 actual parameters and all SQL bytes other than parentheses were unchanged.
This establishes remote compilation, not a successful rollout transaction.
Existing successful rollout, late pause, changed/missing tuple, fourth unknown,
proof/event mutation and atomic rollback tests still apply.

The permanent runtime deny registry's MAX_PROOFS=32 is not a D1 submission
capacity. In the current complete guard, N runtime proofs require 43+5*N
parameters: one uses 48, eleven use 98, twelve use 103 and thirty-two use 203.
D1's separate 100-parameter limit is neither raised nor bypassed by this fix.
The native 32-proof depth test substitutes literal NULL solely to isolate
expression depth; it does not claim a 203-binding rollout can execute. More
proofs must continue to fail closed until a separately reviewed design exists.
