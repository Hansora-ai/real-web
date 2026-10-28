# Voice release checks

Use Gemini 3.8 Live and Leda, with the accepted natural voice instructions.

The worker uses the same native audio path for every business. Browser tests remain free and dry-run; inbound calls preserve business lookup, credits and per-business tools. Database captions are optional and asynchronous; SDK audio, transcript, trace and log recording are disabled. Gemini captions remain approximate and are not proof of what was audibly spoken.

Regression cases: cancelled asynchronous lookups, backend errors without disconnect, shutdown during a tool, interruptions, polite hangup after audio drains, phone/address corrections, topic changes, unknown products and refusing an order.

Before production: compare warm end-to-end caller-audible latency on the same route; validate spoken Armenian/Russian, corrections and an order with the owner; verify saved public-call captions and account isolation; verify credit charging on inbound calls. A generated English browser test is not a telephone acceptance test.

A free Build worker may sleep. Paid production hosting removes that idle cold-start, but is not evidence of faster ongoing replies. Confirm warm phone performance before upgrading.

Do not merge or enable public voice until those gates pass. Existing Instagram messaging/comment files are outside this change. The current US test number is a private, dry-run SIP dispatch. Russian number inventory and Armenian IE eligibility require provider confirmation before a purchase.

## Verified on 2026-10-28

The deployed candidate is cloud agent CA_yH5CZHNwc2MB, version raxsRnxdiG7f, in eu-central. The website pull request remains a draft; worker deployment is independent of the website merge.

- 118 automation tests pass, including inbound called-number routing, rejection of unassigned numbers, business-scoped tools and saved captions, transcript opt-out, and one charge when close/shutdown both fire. Billing verification uses fixtures and does not charge a real customer.
- 21 native transport tests passed before deployment. This follow-up changes tests and documentation only.
- A generated hosted conversation saved both caller and assistant captions to the correct business's call record and inbox. Caption source and call IDs were checked; no human audio or transcript was used.
- Six generated English hosted turns handled product/topic changes. Audible browser response gaps were 1.4–2.0 seconds; no speed improvement was established and these are not PSTN measurements.

## Remaining release blockers

The phone setup page saves preferences only; it does not allocate a telephone number, create a dispatch mapping, or activate forwarding. The current cloud project has one US number attached to a private dry-run business. It must not be treated as a public number for every business or reassigned during a customer's call.

Select the first supported country/provider before implementing production provisioning. LiveKit-managed numbers currently support US inbound calls and do not support outbound calls or TransferSIPParticipant. Other local numbers require a compatible third-party SIP provider and any required account/number verification. Armenian operator integration is scheduled separately after the owner speaks with their engineer.

Before release, verify the current worker by real phone, including unfamiliar names/addresses, phone corrections, language continuity and forwarding. Confirm production hosting capacity and cold-start policy, per-business number ownership/mapping and forwarding verification, and complete one controlled paid inbound call with usage verification. Passing unit tests and a private dry-run call do not complete these steps.

References: https://docs.livekit.io/telephony/start/phone-numbers/ and https://docs.livekit.io/telephony/start/sip-trunk-setup/
