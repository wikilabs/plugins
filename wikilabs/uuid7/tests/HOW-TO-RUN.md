# UUID v7 Plugin Tests

Uses Node.js native test runner (`node:test` + `node:assert`). Requires Node.js 18+.

## Run all tests

```bash
node --test plugins/wikilabs/uuid7/tests/test-*.js
```

## Run a specific test file

```bash
node --test plugins/wikilabs/uuid7/tests/test-creator.js
node --test plugins/wikilabs/uuid7/tests/test-phraselib.js
```

## Test files

| File | What it tests | Dependencies |
|------|--------------|-------------|
| `test-creator.js` | UUID v7 generation, validation, timestamp extraction | None (pure JS) |
| `test-phraselib.js` | Adjective-noun phrase encoding/decoding, wordlist loading, roundtrips | Mocks `$tw.wiki` and TiddlyWiki `require()` |
