# Automation services (Zapier, Make and similar)

## Messages in
Use the service's generic "send a web request" / "webhook" action with:
- Method `POST`, address `{API address}/v1/ext/feedback`
- Header `Authorization: Bearer <key>`, header `Content-Type: application/json`
- A JSON body with the fields from the [README](README.md), filled from the earlier step.

Set `externalId` to the id of the thing that triggered the run so a retry does not store it twice.

## Messages out
To start a run in the service when something happens here, create a "catch a webhook" trigger there, copy its address into Settings, "Messages to other tools", pick the events, and use "Send a test" to give the service a sample. Events, fields and the signature are in [../webhooks.md](../webhooks.md). Most services do not check the signature; if yours does not, treat the address as a secret.

**Not verified against the live services.**
