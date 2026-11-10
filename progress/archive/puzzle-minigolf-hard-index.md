# 迷你高尔夫 · 全程台账索引

- 结果：凶手 **Elyana**，受害者 Valeria，用时 9253s
- 步数：65（每步含 state_before / action / state_after）

| 步 | 动作 | 谁 | 格子数 | 裁决 |
|---|---|---|---|---|
| 0 | init |  | 0 | accept |
| 1 | notes | Ginny | 6 | accept |
| 2 | remove-notes | Ginny | 2 | accept |
| 3 | notes | Idril | 8 | reject |
| 4 | rollback |  | 0 | rollback |
| 5 | undo-notes | Idril | 8 | accept |
| 6 | notes | Burma | 3 | accept |
| 7 | notes | Hugo | 4 | reject |
| 8 | notes | Hugo | 1 | accept |
| 9 | notes | Elyana | 6 | accept |
| 10 | remove-notes | Hugo | 1 | accept |
| 11 | notes | Duncan | 15 | accept |
| 12 | notes | Idril | 12 | accept |
| 13 | remove-notes | Elyana | 4 | accept |
| 14 | remove-notes | Idril | 4 | accept |
| 15 | remove-notes | Duncan | 2 | accept |
| 16 | x-mark | row1 | 2 | accept |
| 17 | notes | Albert | 3 | reject |
| 18 | notes | Albert | 28 | accept |
| 19 | remove-notes | Albert | 2 | accept |
| 20 | remove-notes | Duncan,Hugo | 3 | accept |
| 21 | x-mark | row6 | 7 | accept |
| 22 | remove-notes | Albert | 9 | accept |
| 23 | remove-notes | Idril,Duncan,Hugo | 5 | accept |
| 24 | x-mark | row3 | 2 | accept |
| 25 | notes | Faith | 17 | accept |
| 26 | notes | Valeria | 27 | accept |
| 27 | notes | Faith | 3 | accept |
| 28 | notes | Craig | 37 | accept |
| 29 | x-mark | grid | 1 | accept |
| 30 | remove-notes | Albert | 2 | accept |
| 31 | remove-notes | Albert | 2 | accept |
| 32 | remove-notes | Hugo | 1 | accept |
| 33 | remove-notes | Craig | 4 | accept |
| 34 | remove-notes | Craig | 5 | accept |
| 35 | x-mark | grid | 4 | accept |
| 36 | notes | Hugo | 1 | accept |
| 37 | remove-notes | Valeria | 3 | rollback |
| 38 | deduce | 通用线索-木桶 | 4 | accept |
| 39 | deduce | 木桶区 | 7 | accept |
| 40 | remove-notes | Valeria | 3 | accept |
| 41 | x-mark | grid | 2 | accept |
| 42 | x-mark | grid | 1 | accept |
| 43 | x-mark | grid | 1 | rollback |
| 44 | remove-notes | Craig | 2 | accept |
| 45 | x-mark | grid | 1 | accept |
| 46 | x-mark | grid | 1 | accept |
| 47 | x-mark | grid | 3 | accept |
| 48 | remove-notes | A,B,D,C,F,V | 7 | accept |
| 49 | place | Burma | 1 | accept |
| 50 | remove-notes | Ginny,Idril,Faith,Valeria,Craig | 5 | accept |
| 51 | x-mark | grid | 12 | accept |
| 52 | place | Hugo | 1 | accept |
| 53 | x-mark | grid | 4 | accept |
| 54 | x-mark | grid | 5 | accept |
| 55 | place | Ginny | 1 | accept |
| 56 | place | Idril | 1 | accept |
| 57 | place | Albert | 1 | accept |
| 58 | place | Duncan | 1 | accept |
| 59 | place | Elyana | 1 | accept |
| 60 | x-mark | grid | 1 | accept |
| 61 | place | Valeria | 1 | accept |
| 62 | place | Faith | 1 | accept |
| 63 | place | Craig | 1 | accept |
| 64 | submit | 全部 | 0 | none |
