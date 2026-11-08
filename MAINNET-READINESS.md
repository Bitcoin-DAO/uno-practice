# Mainnet readiness

**Goal:** move the first DAO to mainnet as soon as every part of btc-dao has been shown to work in the wild, not only in the automated tests.

**Why in the wild:** the automated tests run a simulated chain and passed throughout UNO's practice run, while the real network found five issues in one day (throttled requests, a single chain source, a false "Broadcast ✓", a transaction that never spread, fees and empty blocks). Only real networks, real phones and real people find these.

**Where each item is tested**

| Stage | Network | What it proves |
| --- | --- | --- |
| UNO practice | testnet4, 2 of 2, two phones, short votes | The whole life of a DAO, quickly, with the developer at hand |
| UNO testnet | testnet4, hardware signing | SeedSigner, recovery without the website, real vote lengths |
| Sandbox DAO | testnet4, 3 of 5, all remote | Strangers, many devices, signatures spread over days |
| First mainnet DAO | mainnet, treasury capped (S9) | Three monthly rounds without developer help (release condition in FORK-TASKS.md) |

**Rule:** an item is ticked only when it has passed on a real network, with the release and the date written next to it. A fix found in one stage is released, and the item is tested again.

**Status:** started 6 November 2026, at v0.1.6.

## 1. Founding and identity

- [x] Founding in person and remote, 2 of 2, short codes checked (UNO practice, v0.1.1–v0.1.5, 6 Nov 2026)
- [ ] Remote founding with strangers, 3 of 5, through the group (Sandbox DAO)
- [ ] Passkeys on iPhone (Safari) and Android (Chrome), and a passkey synced to a second device
- [x] Identity card used to restore on a phone with its site data cleared: same identity, new passkey (UNO practice, @founder1, v0.1.7, 8 Nov 2026)
- [ ] Sign-in on a phone that has never seen the DAO, from the site address only

## 2. Treasury reading

- [x] Balance, movements and funding address read through an unstable indexer, with the remembered reading shown (UNO practice, v0.1.4)
- [ ] Second chain source used when the first fails. Not proven: Zelcore's Blockbook refuses reads from web pages (CORS), shown by v0.1.8 on 8 Nov 2026, so on 6 Nov mempool.space most likely did all the work. Works in the end-to-end tests against a mock
- [ ] The DAO's own chain gateway as the first chain source (design: `docs/chain-gateway.md`; provider behind it now, own node optional later)
- [ ] Change returned by a round is shown and spent in the next round
- [ ] Treasury read with many movements (10 or more)

## 3. Proposals and votes

- [x] Payout proposal with recipient confirmation, voted and passed (UNO practice, 6 Nov 2026)
- [x] Rejected proposal (fails on votes): UNO-0002, 0 yes, 2 no (UNO practice, v0.1.6, 6 Nov 2026)
- [ ] Proposal without quorum
- [ ] Vote changed before the close
- [x] Rule change, confirmed by the council: UNO-0003, payouts monthly to weekly, rules version 2 (UNO practice, v0.1.6, 6 Nov 2026)
- [ ] Rule change of the fee setting, once released
- [ ] Statement proposal
- [ ] Votes of the real length (days), with members voting on different days (Sandbox DAO)

## 4. Membership

- [x] New member proposed, short code checked (two council checks), voted in, member list version 2 approved by the council: @member1 (UNO practice, v0.1.7, 8 Nov 2026)
- [x] Member leaves: immediate, then member list version 5 approved by the council (@member1, UNO practice, v0.1.7, 8 Nov 2026)
- [ ] Member removed by a two-thirds vote
- [ ] Council change (a council member replaced, new descriptor)
- [x] Lost key: card restore (@founder1) and key replacement without the card, remote, twice in a row, with member list versions 3 and 4 (@member1, now VNTH · SY98) (UNO practice, v0.1.7, 8 Nov 2026)
- [~] Trial stages: a council member restores from the card and types the 12 words of the trial treasury key back in; same fingerprint (8c37eb1f) (UNO practice, v0.1.7, 8 Nov 2026). Still to do: sign a round with it

## 5. Payout rounds

- [x] First payout confirmed on chain, receipt published, proposal shows paid (UNO practice, round 2026-11, v0.1.6, 6 Nov 2026: 5,000 sats, fee 181, block 159459, tx `610238de…a3b`. Reached the network on the second attempt, through Blockbook; one reorg on the way)
- [ ] A broadcast reaches the network first time, and the round confirms within a few blocks (fee setting released)
- [ ] Round with several payouts
- [ ] Signatures collected over days (Sandbox DAO, 3 of 5)
- [ ] A council member declines a round, with the reason shown
- [ ] Payment that lapses after two rounds
- [ ] Fee above the charter cap: the round waits (S5)
- [ ] A confirmation removed by a reorg does not produce a receipt; the round waits again (seen on testnet4, 6 Nov 2026: round 2026-11 was mined, then its block dropped)
- [ ] Closing: the whole balance returns to the BTC DAO Testnet Treasury

## 6. Hardware signing and recovery (UNO testnet)

- [ ] SeedSigner signs a round from the copied PSBT, the signed PSBT is pasted back
- [ ] Descriptor loaded on the SeedSigner, change shown as verified (S7, hard gate)
- [ ] Every address shown in full and compared on the device (S1)
- [ ] UNO restores and spends its treasury in Sparrow without the website

## 7. Infrastructure and security

- [ ] Own indexer (Bitcoin Core plus Blockbook or Esplora) running and monitored
- [ ] Org relay and the public relays: events found after a day, a week, a month
- [ ] Site mirrored on a second host; releases signed with a published hash (S2)
- [ ] Final tallies published at every close; late votes ignored (S3)
- [ ] State edge cases written as test cases and passing (S4)
- [ ] Independent code review

## 8. Mainnet launch conditions

- [ ] Sections 1 to 7 ticked
- [ ] Treasury cap set in the charter at an amount the members can afford to lose (S9)
- [ ] Main and spare SeedSigner from different sources (S8)
- [ ] Mainnet config: chain sources (own indexer first), fee setting, relays

## Next release (findings not yet built)

From UNO's practice run, 6 November 2026:

1. After publishing the founding settings, say what happens next and show who has approved.
2. After founding, a "Fund the treasury" step.
3. Home page: make clear a round can be prepared as soon as payments are approved.
4. Treasury reading names its source: "Read from the blockchain: 15:24 · via Blockbook".
5. Fee setting in the DAO's rules, **fast** (default) or **economical**, changed by a rule-change vote. Fast aims for the next block with 25% headroom and a floor of 2 sat/vB; the charter cap stays, with a warning when the fast rate is above it; a check before broadcast if the rate has risen while signatures were collected; the fee shown to signers in sats, as a share of the payouts, and with its aim. No replace-by-fee.
6. A broadcast goes to every chain source, not only the first that accepts.
7. Founder guide: each member uses their own Google or Apple account for the passkey.
8. Receipts wait for depth: a receipt is published only after several confirmations (3 on testnet4, set in the config), and the round page shows "Confirmed in block … (1 of 3)" until then. Seen in round 2026-11: one confirmation, then a reorg.
9. A source answering that it already has the transaction counts as accepted, not as an error.
10. Any viewer's round page reads the chain: once the transaction confirms, it shows "Confirmed on chain, receipt waiting for a council member" until a council phone publishes the receipt. Receipts are published only by a council member's open app, so they can lag behind the chain.
11. Rules page: show short voting periods in minutes or hours ("10 minutes", not "0.007 days").
12. Stop browser translation: the page starts marked as Italian, so Chrome offers to translate it, and translated "UNO" as "A". Mark the page `translate="no"` (the app has its own EN · IT switch) and set the starting language from the visitor's choice before the first paint.
13. After a card restore, the header still shows "Sign in" until the next page; it should show the member's name at once.
14. A page for council members, opened while signed out, says only "This page is for council members"; it should offer Sign in and Come back with your card.
15. Replacing a council member's key needs approvals from other council members up to the threshold. When the threshold equals the council size (UNO practice's 2 of 2), it can never be reached, because the member who lost their key cannot approve. The Replace page should say so before anyone starts, instead of leaving a replacement waiting for ever.
16. Founding setup: warn when the threshold equals the council size. One lost key then blocks both the treasury and key replacements. Recommend at least one spare (3 of 5, 2 of 3).
17. Printing the identity card gives a blank second page and the browser's own header and footer (URL, date): the print style hides the rest of the page but keeps its space. Remove it from the print layout and set page margins so only the card prints, on one page.
18. The candidate page says "in person: 1 check · on a video call: 2", and the welcome page "You join in person or on a video call", while the council chooses "remote", and remote joining needs no call. Use the same words everywhere.
19. After a browser's site data is cleared, its passkeys still appear (they live in the Google or Apple account) but open nothing, and the message asks "Did you pick the right passkey?". Say instead that this browser no longer has the key the passkey protects, and point to the card or "I lost my key and card". Name passkeys so old and new ones can be told apart.
20. Key replacement: once the council has approved and checked the new key, the new key still waits for the next member list version, and the member's page shows only "On the member list: Not yet". Say what it is waiting for ("the council publishes the new member list"). A member who taps Sign in meanwhile gets a passkey error, because the passkey is only made at the end; Sign in should take someone with a replacement under way back to its waiting page.
21. Two council members can each start a replacement for the same new key. Once one takes effect, the other can never complete (the key is already in use), yet it stays on every council member's Council page as "Approve", and counts in the to-do badge, for ever. Hide replacements whose new key is already in effect, or whose old key is no longer the member's, and stop a second replacement for a key that already has one under way.
22. After leaving, the profile still offers member actions (Propose a new member, payout address, Print the card). Show only what a former member can do: the record, and joining again. Confirmations use the browser's own dialog ("The page at https://bitcoin-dao.github.io says"); use the app's own, in its language.
23. Payout proposals: a **Share** button for the recipient's confirmation link, next to "Copy the confirmation link", like the founder code's Share. The message names the DAO, the proposal number and title, and the amount, then the link, so the recipient knows what they are confirming before opening it. Copy stays where sharing is not available.
24. When the chain cannot be read, the error shows only the last failure ("/address/…: Failed to fetch"), so nobody can tell whether one source or all of them failed, or why. List each source with its own reason (done in v0.1.8). Also cut the load: several open pages each read the treasury every few minutes and every "Try again" starts a new reading of about 15 requests, which can get a public source to throttle the DAO. Share one reading between open pages, and wait before a manual retry.
25. Zelcore's testnet4 Blockbook does not let web pages read its API (no CORS header), so the app can use it only as the manual broadcast page. With mempool.space down, UNO's closing round could not be prepared (8 Nov 2026). Before mainnet: our own indexer, served with CORS for the DAO's site, as the first source; any public source checked from a web page before it goes into a config. Consider a separate config entry for broadcast pages, so a source that cannot be read is not asked on every reading.
