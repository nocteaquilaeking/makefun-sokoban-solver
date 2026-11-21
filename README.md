# Sokoban solver

An entry for make.fun's **Build the best Sokoban solver** bounty.

The solver splits each level into independent rooms connected by a hallway.
Boxes never leave their room in an optimal solution, so the level's optimal
push count is the sum of the room optima.

Each room is solved with push-level A*, using an exact minimum-cost
box-to-goal matching heuristic over reverse-push distances, static dead-square
pruning, and frozen-block deadlock checks. BFS walk paths connect the pushes
and stitch the room solutions into a complete move sequence.

Room A* initially allows 160,000 expanded nodes and 350,000 stored nodes.
If either budget is exhausted without a solution, the room is retried once
with quadrupled limits (640,000 and 1,400,000), using the same heuristic and
pruning. Greedy best-first search is the next fallback, followed by a
whole-level A* fallback if needed. All search budgets use deterministic node
counters, never wall-clock time. The final move sequence is validated; if no
valid solution is available, the solver writes an empty solution file.

## Practice result

All five practice instances solved at exactly their push-optimal count P*.
The official scorer reported **1,000,000 / 1,000,000**, compared with the
house `plain-astar` baseline's **200,000**.

## Run

```sh
node main.ts /path/to/input /path/to/output
```

The directories default to `/input` and `/output`. Each input instance
`i001` through `i005` contains `level.txt`; its output contains `solution.txt`.
