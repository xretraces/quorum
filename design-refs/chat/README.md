# Quorum — Chat Window Design References

Mobbin screens (iOS, high-res ~1179×2676 webp) collected as visual references for Quorum's mobile-first group chat: friends talk, Grok drops 2–3 plan cards into the chat, everyone votes approve/reject, then each person pays a Stripe hold.

> Images were downloaded from Mobbin (the preview URLs expire). The Mobbin links need a Mobbin login to open. Screens show real third-party apps and are only here as internal reference, not assets to ship.

## Group chat base: bubbles, composer, header

| # | File | App | Mobbin | What Quorum should borrow |
|---|------|-----|--------|---------------------------|
| 01 | `01-luma-group-chat-bubbles.webp` | Luma | [link](https://mobbin.com/screens/f0f8e0f3-6cb9-4c41-8bc9-05122ff973ac) | **Our main bubble model.** Grey incoming and blue outgoing bubbles, a small sender name above each run of messages, a 24px avatar next to the last bubble only, emoji reactions tucked under a bubble, a quoted-reply preview, and centered grey system lines ("Sam Lee started a group chat"). The header has a round group emoji avatar with the name in a pill. |
| 02 | `02-chatgpt-group-chat-ai-member.webp` | ChatGPT (group chats) | [link](https://mobbin.com/screens/7126f028-6eb0-4003-8f4b-b204e726c330) | **How an AI sits in a group chat.** ChatGPT's replies are plain text with no bubble and a small "ChatGPT" label, while people get grey bubbles and avatars. Grok should look just as different from humans. The floating rounded composer with a reply-quote chip above it and a round black send button is also worth copying. |
| 03 | `03-x-group-chat-header-avatars.webp` | X (DMs) | [link](https://mobbin.com/screens/b47438fe-1318-4a1d-a304-05c40446691f) | **Group header.** Two overlapping member avatars centered above bold member names, plus a system line ("There are 2 other people in this group") with a tappable link. Timestamp and "Seen by 1 person" sit under the bubble, and a "1 new message" divider marks unread messages. |
| 04 | `04-xchat-group-typing-indicator.webp` | XChat | [link](https://mobbin.com/screens/0dd41980-ec50-40e4-a405-63734baa96bb) | **Typing indicator.** A grey bubble with three animated dots, attached to the typing member's avatar, the same shape as a normal incoming bubble. The header is a stacked-avatar cluster with a small subtitle pill ("5 minutes"). The composer is minimal: a "+" circle, a pill input, and a mic icon. |
| 20 | `20-chatgpt-group-ai-thinking-state.webp` | ChatGPT (group chats) | [link](https://mobbin.com/screens/d72c81b0-89f2-42f4-accb-60c86e37d981) | **Grok "thinking" state.** Instead of dots it shows a shimmering text line: "**ChatGPT** is taking a look". Use "**Grok** is putting together plans…" while the plan cards generate. |

## In-chat voting / poll cards (for approve/reject on plans)

| # | File | App | Mobbin | What Quorum should borrow |
|---|------|-----|--------|---------------------------|
| 05 | `05-whatsapp-group-poll.webp` | WhatsApp | [link](https://mobbin.com/screens/7cb91cb0-89b4-4299-8955-dad4d3feca27) | **A poll inside a bubble.** Bold question, a "Select one" hint, radio rows with a thin progress bar and a vote count on each row, and a full-width "View votes" footer. The card sits in the normal message stream and keeps its timestamp and read ticks. |
| 06 | `06-discord-poll-card-vote-button.webp` | Discord | [link](https://mobbin.com/screens/1ed53037-dce2-4d79-838b-50b4e30085f9) | **A clear vote step.** Options are rounded rows with a checkbox that turn outlined in accent color when picked, then a full-width solid "Vote" button, then a footer with "0 votes • 59m left" and "Show results". The countdown is a good fit for a voting deadline. |
| 07 | `07-locals-poll-results-card.webp` | Locals | [link](https://mobbin.com/screens/2eeb6f6b-9dc9-4636-b7ff-2ba601d5cf34) | **Results after voting.** A bold colored card with percentages on the left, a checkmark on the winning option, a filled progress line, and a voter-avatar chip ("1 voter ›") at the bottom. Use this for the "Plan approved 4/5" state. |
| 08 | `08-teams-poll-vote-then-results.webp` | Microsoft Teams | [link](https://mobbin.com/screens/e50d1fb2-063c-4470-ad84-6a2a082fee7b) | **Before and after.** The same poll appears first as an input card (checkboxes and "Submit Vote") and then as a results card ("Yes 100% (3)", "3 responses"). The results card is posted by the app ("John M. via Polls"), which is a good attribution pattern for "Grok via Quorum". |

## Rich plan / event cards with actions

| # | File | App | Mobbin | What Quorum should borrow |
|---|------|-----|--------|---------------------------|
| 09 | `09-groupme-event-card-im-in-cant-go.webp` | GroupMe | [link](https://mobbin.com/screens/77aed4f9-b1f0-473f-9da2-5cc71caa61d3) | **Closest match to a Quorum plan card with approve/reject.** A calendar-date tile, title, time, and location, then two pill buttons side by side: "👍 I'm in", which gets a tinted fill and border when chosen, and "😩 Can't go". A map/location card follows below. Copy the button pair for Approve/Reject. |
| 10 | `10-whatsapp-event-card.webp` | WhatsApp | [link](https://mobbin.com/screens/d8273672-25ed-4266-b152-0a05806d5904) | **A small event bubble.** Icon, bold title with emoji, time range, a secondary line, a "1 Going" avatar count, and a divided full-width action row ("Edit event"). A good compact collapsed state for a plan once it's decided. |
| 11 | `11-line-event-rsvp-card.webp` | LINE | [link](https://mobbin.com/screens/075e62f9-8694-4d5f-812b-34ca794ff5a8) | **A card with a hero image.** Colored header block with an icon, title, one-line description, a full-width green "View now" CTA, and a small source footer ("LINE Schedule ›"). An ended poll card sits above it, which shows how several cards stack in one conversation. |
| 12 | `12-lex-group-chat-event-card.webp` | Lex | [link](https://mobbin.com/screens/99f32d54-5caa-40ef-bc77-503265042435) | **An event card in a group chat attached to the composer.** Cover art on top and a title/date/address block, attached to the input box while it's being shared. Also: a "Details / Chat" tab bar under the header, useful if Quorum splits the plan summary from the chat. |
| 13 | `13-fiverr-join-decline-action-card.webp` | Fiverr | [link](https://mobbin.com/screens/3ebdfd1d-ba68-43fb-b545-1d96c4c8e6a6) | **Stacked primary and secondary actions.** A solid indigo "Join" button above an outlined "Decline" button, full width inside a bordered card, with an icon, a title, and fine print. This is the vertical option if side-by-side Approve/Reject is too tight on small phones. |
| 14 | `14-beside-calendar-card-ai-chips.webp` | Beside | [link](https://mobbin.com/screens/bf624e99-d1a8-487a-bbdf-dce88001fb4b) | **A card generated from chat text, plus AI quick actions.** A "Calendar Event" card with a red accent bar and an "Add to Calendar" button, with an "Only visible to you" note. The composer has a row of scrollable chips above it ("Ask Beside AI", "Saved Replies"). Use a "✨ Ask Grok for plans" chip the same way. |

## Payment / split cards (for the Stripe hold step)

| # | File | App | Mobbin | What Quorum should borrow |
|---|------|-----|--------|---------------------------|
| 15 | `15-revolut-group-bill-cards.webp` | Revolut (group "Party") | [link](https://mobbin.com/screens/61d50a5b-ccad-4936-9b7d-1a380171de8b) | **Best pay-card reference.** Big bold amount ($6.74), a small status tag ("You lent", "✅ Marked as paid"), a "Paid $10.10 · To…" line, and a row of participant avatars, all inside an accent bubble. The header subtitle shows group money status ("✓ You are settled up"), and a full-width "+ Add a bill" button sits above the composer. |
| 16 | `16-expensify-group-split-card.webp` | Expensify ("Trip budget group") | [link](https://mobbin.com/screens/770808d2-927a-4153-b669-b958922cfc4e) | **A split card in a group thread.** Receipt thumbnail, "Jun 18 · Split" with member avatars, merchant and total on the right, and "Your split $5.00" in muted text. Also a checklist item ("Book a hotel") inline in the chat. Use it to show each person's share of the hold. |
| 17 | `17-vipps-payment-request-card.webp` | Vipps | [link](https://mobbin.com/screens/850da071-35c4-44d6-8977-8d16d9663862) | **Payment request states.** A centered card with "↓ You requested", a large amount, a note, and a status footer. The cancelled state strikes through the amount. Use this state styling for holds: pending → authorized → released/charged. The composer adds "Send" and "Request" quick buttons. |

## AI assistant message styling

| # | File | App | Mobbin | What Quorum should borrow |
|---|------|-----|--------|---------------------------|
| 18 | `18-spark-ai-summary-message.webp` | Spark Mail (team chat) | [link](https://mobbin.com/screens/a3a32838-87bc-408f-86a7-e5d6651d665c) | **An AI message in a human thread.** The AI block runs full width with a light purple/lavender tint and an "+ai Summary" label with an icon, a timestamp, and a "•••" menu. It clearly breaks from the avatar-and-bubble human messages around it. This is a strong model for Grok's plan-proposal header. |
| 19 | `19-noom-ai-reply-suggestion-chips.webp` | Noom | [link](https://mobbin.com/screens/f3ebca91-37ea-4846-a830-361415e89670) | **Follow-ups after an AI reply.** A long AI bubble with a bot avatar, thumbs up/down feedback, then outlined suggestion chips ("More snack ideas please"). Use "Cheaper options", "Somewhere closer", and "Regenerate plans" chips under Grok's cards. |

## Patterns to use in Quorum

- **Bubble system (Luma/XChat):** Incoming bubbles are `bg-gray-100` and outgoing are brand-color bubbles (`rounded-2xl`, tighter corner at the tail). Show the sender name only on the first message of a run and the avatar only on the last. Centered `text-xs text-gray-400` lines for system events ("Maya joined", "Plan B approved").
- **Grok looks different from people (ChatGPT/Spark):** Grok gets no normal bubble. Use a full-width block with a subtle tinted background, a "✨ Grok" label, and a "Grok is putting together plans…" shimmer while generating. Its plan cards follow as their own cards.
- **Plan card = event card + vote pair (GroupMe/WhatsApp/Discord):** Photo or emoji header, title, date/time, place, price per person, and a row of voter avatars. Show "Approve" and "Reject" as two pill buttons side by side (selected = tinted fill + border). Show 2–3 cards as a horizontal snap-scroll carousel or stacked vertically.
- **Live tally + deadline (Locals/Teams/Discord):** After voting, the card switches to results: a progress bar per plan, an "4/5 approved" avatar chip, a checkmark on the winner, and a "closes in 45m" countdown in the footer.
- **Pay card (Revolut/Vipps/Expensify):** Big bold amount, a small status tag (Pending → Hold placed ✓ → Charged / Released), "Your share $18.50 of $92.50", participant avatars with paid/unpaid state, and a single primary "Pay hold" button. Show group status in the header subtitle ("3 of 5 paid").
- **Header (X/XChat/Luma):** Back arrow, stacked avatars (max 3 + "+2"), group name, and a subtitle that changes with the flow's state (voting open → paying → all set). Tap to open members.
- **Composer (ChatGPT/Beside):** A floating rounded pill with a "+" on the left and a round send button. Put a horizontally scrollable chip row just above it ("✨ Ask Grok for plans", "Split cost") and a quoted-reply chip when replying.
- **Typing and states:** A three-dot bubble next to the typer's avatar, a "New messages" divider, and "Seen by N" under the last outgoing message. After a vote, collapse finished cards into compact bubbles (WhatsApp event style) so the chat stays readable.
