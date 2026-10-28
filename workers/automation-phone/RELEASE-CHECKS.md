# Voice release checks

Use Gemini 3.8 Live and Leda, with the accepted natural voice instructions.

The worker uses the same native audio path for every business. Browser tests remain free and dry-run; inbound calls preserve business lookup, credits and per-business tools. Database captions are optional and asynchronous; SDK audio, transcript, trace and log recording are disabled. Gemini captions remain approximate and are not proof of what was audibly spoken.

Regression cases: cancelled asynchronous lookups, backend errors without disconnect, shutdown during a tool, interruptions, polite hangup after audio drains, phone/address corrections, topic changes, unknown products and refusing an order.

Before production: compare warm end-to-end caller-audible latency on the same route; validate spoken Armenian/Russian, corrections and an order with the owner; verify saved public-call captions and account isolation; verify credit charging on inbound calls. A generated English browser test is not a telephone acceptance test.

A free Build worker may sleep. Paid production hosting removes that idle cold-start, but is not evidence of faster ongoing replies. Confirm warm phone performance before upgrading.

Do not merge or enable public voice until those gates pass. Existing Instagram messaging/comment files are outside this change. The current US test number is a private, dry-run SIP dispatch. Russian number inventory and Armenian IE eligibility require provider confirmation before a purchase.
