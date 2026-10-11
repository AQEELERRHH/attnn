# Tests

| Command | What it checks | Needs |
| --- | --- | --- |
| `npm run test:unit` | The pure rules: amounts, replies, the creator agent's cut-off, profile fields, onboarding, request origin | Nothing |
| `npm run test:integration` | The money paths: placing, settling, refunds, the races between them, the agent lock, counter-offers, wallet routes | A throwaway local Postgres |
| `npm run test:contracts` | The escrow and registry contracts (Foundry) | `npm run setup:contracts` once |
| `npm test` | Unit, then integration | Same as integration |

All of them run on every pull request (`.github/workflows/ci.yml`).

## Running the integration tests locally

They drop and recreate the database schema, so they only run against `TEST_DATABASE_URL`, and refuse any host that isn't `localhost`, `127.0.0.1` or the CI service. They can't touch Supabase.

```bash
docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=attnn_test postgres:16
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/attnn_test npm run test:integration
```

## How they work

Only the network edges are faked (`tests/helpers/fakes.mts`): Circle, the Arc chain and Inngest. Everything between them runs as in production against a real Postgres, including the row locks and conditional updates that stop double payments. Each test file applies every migration in `drizzle/` to a fresh schema, so the migrations are tested too.

A new money rule needs a test that fails without it. When fixing a race, check the test fails with the fix removed.
