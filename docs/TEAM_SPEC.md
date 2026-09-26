# HackGT AI Group Planning MVP

You are building a working MVP for a HackGT hackathon. We have approximately 20 hours, so prioritize a reliable end-to-end demo over production-level complexity.

## 1. Product Concept

Build a web application that turns a messy group conversation into an agreed-upon plan.

Users can:

1. Create or join a group.
2. Enter their name and personal spending limit.
3. Chat with the group about what they want to do.
4. Click "Generate Plan."
5. The AI analyzes the conversation and creates a structured group plan.
6. The application calculates each person's estimated share.
7. The application checks each person's spending limit.
8. If someone is over budget, that person must explicitly approve the plan.
9. Everyone must approve the final plan.
10. Once everyone approves, users can "Book & Split Cost."
11. Booking/payment should be simulated or use test mode. Do NOT build real money transfers.

The core value proposition is:

> Turn group-chat chaos into a plan everyone can agree on without endless back-and-forth.

---

# 2. Technology Stack

Use the following stack unless there is a strong technical reason not to:

### Frontend

* React
* Vite
* Tailwind CSS
* JavaScript or TypeScript

### Backend

* Node.js
* Express

### AI

* Grok API

Use an environment variable:

`GROK_API_KEY`

Never hardcode API keys.

### Database / persistence

Use Firebase Firestore if practical.

Store:

* Groups
* Users
* Messages
* Spending limits
* Generated plans
* Approval status

If Firebase setup would significantly slow down development, implement a simple in-memory/local persistence fallback so the complete demo still works.

### Optional integrations

Only implement these if the core application is already working:

* Google Places API for restaurants/activities
* Stripe test mode for simulated payment

Do NOT let external API integration prevent the core demo from working.

### Deployment

Prefer:

* Vercel for frontend
* Render/Vercel/Firebase for backend

Deployment is secondary to having a working local application.

---

# 3. Critical Scope Constraint

This is a 20-hour hackathon project.

DO NOT build:

* Real financial transfers
* Production payment processing
* Real booking infrastructure
* Complex authentication
* Microservices
* Advanced recommendation algorithms
* A social network
* Complex voice processing
* Complicated role/permission systems
* Anything that is not necessary for the core demo

The booking/payment portion can be simulated.

The application should prioritize:

**Working end-to-end flow > feature count > production complexity**

---

# 4. Main User Flow

Implement exactly this flow:

```text
START
  ↓
Create / Join Group
  ↓
Enter Name + Spending Limit
  ↓
Group Chat
  ↓
Generate Plan
  ↓
Send Conversation + User Information to Grok
  ↓
AI extracts preferences and generates structured plan
  ↓
Display Plan
  ↓
Calculate individual costs
  ↓
Check everyone's spending limits
  ↓
Are all users within budget?
  ├── YES → Normal approval
  │
  └── NO → Over-budget users must explicitly approve
                  ↓
            Group Approval
                  ↓
            Everyone approved?
              ├── NO → Wait / Modify Plan
              └── YES → Book & Split Cost
                              ↓
                       Simulated Booking
                              ↓
                       Confirmation Screen
```

---

# 5. Screen 1: Home

Create a simple landing page.

Display:

## GroupPlan

A short tagline:

> Turn group-chat chaos into a plan everyone agrees on.

Buttons:

* `Create Group`
* `Join Group`

For the hackathon demo, group codes can be simple.

Example:

`HACK42`

---

# 6. Screen 2: Create Group

Allow the user to enter:

* Name
* Spending limit

Example:

```text
Name:
[ Thang ]

Maximum spending:
[ $50 ]

[ Create Group ]
```

After creating the group, show a group code.

Example:

```text
Your Group Code

HACK42

Share this code with your friends.

[ Enter Group Chat ]
```

---

# 7. Screen 3: Join Group

Allow a second user to enter:

* Name
* Spending limit
* Group code

Example:

```text
Name:
[ Mike ]

Maximum spending:
[ $40 ]

Group Code:
[ HACK42 ]

[ Join Group ]
```

---

# 8. Screen 4: Group Chat

Create a simple chat interface.

Each message should contain:

* Sender
* Message
* Timestamp

Example:

```text
Thang
What should we do Saturday?

Sarah
I'd like to do something active.

Mike
I'm down for bowling.

Thang
I don't want to spend more than $50.

Sarah
I'm free after 6 PM.

Mike
My max is $40.
```

Users should be able to type messages.

Include:

`[ Send ]`

At the bottom include:

`[ Generate Plan ]`

---

# 9. AI Plan Generation

When the user clicks "Generate Plan":

Send the conversation and group member information to the backend.

The backend sends the relevant information to Grok.

The AI should extract:

* Number of people
* Names
* Date
* Time
* Activity preferences
* Food preferences
* Location if mentioned
* Individual budget limits
* Other relevant constraints

Then generate a proposed plan.

IMPORTANT:

The AI should return structured JSON.

Use a format similar to:

```json
{
  "plan": {
    "title": "Bowling Night",
    "date": "Saturday",
    "time": "7:00 PM",
    "activity": {
      "name": "Bowling",
      "estimated_cost_per_person": 25
    },
    "food": {
      "name": "Pizza",
      "estimated_cost_per_person": 17
    },
    "estimated_total": 126,
    "estimated_cost_per_person": 42
  },
  "summary": "Bowling followed by pizza after 6 PM.",
  "preferences_used": [
    "Saturday",
    "After 6 PM",
    "Active activity",
    "Bowling",
    "Budget limits"
  ]
}
```

The exact values should depend on the conversation.

Do not hardcode the example plan as the only possible result.

---

# 10. AI Rules

The AI must NOT invent critical user preferences when they are missing.

For example, if the conversation only says:

> "Let's do something this weekend."

The AI should indicate that more information is needed.

For example:

```json
{
  "needs_clarification": true,
  "questions": [
    "What day works for everyone?",
    "What type of activity would the group prefer?"
  ]
}
```

Display those questions to the user.

Do not silently invent dates, budgets, or preferences.

---

# 11. Budget Validation

This is VERY IMPORTANT.

Do NOT ask the AI to determine whether someone is within budget.

The backend must calculate this using normal application code.

For each person:

```text
individual_cost <= spending_limit
```

If true:

```text
within_budget = true
```

If false:

```text
within_budget = false
requires_approval = true
```

Example:

```text
Thang
Estimated cost: $42
Limit: $50
✓ Within budget

Sarah
Estimated cost: $42
Limit: $60
✓ Within budget

Mike
Estimated cost: $42
Limit: $40
⚠ Over budget
```

The application should calculate the difference:

```text
$42 - $40 = $2 over budget
```

---

# 12. Plan Screen

Display the generated plan in a clean card.

Example:

```text
--------------------------------
       YOUR GROUP PLAN
--------------------------------

🎳 Bowling

Saturday
7:00 PM

🍕 Pizza
8:30 PM

Estimated total: $126
Estimated per person: $42

--------------------------------
BUDGET CHECK
--------------------------------

Thang
$42 / $50
✓

Sarah
$42 / $60
✓

Mike
$42 / $40
⚠ $2 over budget

--------------------------------

[ Approve Plan ]
[ Modify Plan ]
```

Make the UI visually polished but simple.

---

# 13. Approval System

Every group member needs an approval status.

Possible statuses:

```text
pending
approved
rejected
```

Example:

```text
GROUP APPROVAL

Thang       ✓ Approved
Sarah       ✓ Approved
Mike        ⏳ Pending
```

The booking button must remain disabled until everyone has approved.

Do NOT allow the creator to override another person's approval.

---

# 14. Over-Budget Approval

If a person's estimated cost exceeds their spending limit, explicitly tell them.

Example:

```text
⚠ Budget Alert

Your spending limit: $40
Estimated cost: $42

This plan is $2 over your limit.

[ Approve Anyway ]
[ Reject Plan ]
```

If they click:

`Approve Anyway`

their status becomes:

```text
approved
```

If they click:

`Reject Plan`

their status becomes:

```text
rejected
```

The plan cannot be booked while somebody has rejected it.

---

# 15. Rejected Plan

If any member rejects the plan:

Display:

```text
Mike rejected the plan.

Reason:
Too expensive.

[ Modify Plan ]
```

Return the group to the planning stage.

For the MVP, "Modify Plan" can simply allow the user to generate another plan or manually adjust the estimated cost.

Do not build a complex optimization system.

---

# 16. Booking

When everyone approves:

```text
Thang       ✓
Sarah       ✓
Mike        ✓
```

Enable:

`[ Book & Split Cost ]`

Clicking this should create a simulated booking.

Display:

```text
BOOKING CONFIRMED 🎉

Bowling
Saturday • 7:00 PM

3 people

Total: $126

Thang       $42 ✓
Sarah       $42 ✓
Mike        $42 ✓

Payment: Simulated

[ Done ]
```

The application should make it very clear that payment is simulated/test-mode.

---

# 17. Optional Stripe Integration

ONLY implement this after the entire core flow works.

If Stripe is used:

* Use Stripe test mode only.
* Never use real payments.
* Never store card information.
* Use test credentials.
* The main demo must still work if Stripe is unavailable.

If Stripe takes too much development time, remove it and use the simulated payment screen.

---

# 18. Optional Google Places Integration

ONLY implement this after the core flow works.

If available, Google Places can be used to find:

* Restaurants
* Bowling
* Activities
* Locations

However, the app must have fallback mock data.

Do not allow an API failure to break plan generation.

---

# 19. Suggested Backend API

Create simple REST endpoints.

### Groups

```text
POST /api/groups
GET /api/groups/:groupId
POST /api/groups/:groupId/members
```

### Messages

```text
GET /api/groups/:groupId/messages
POST /api/groups/:groupId/messages
```

### AI

```text
POST /api/groups/:groupId/generate-plan
```

### Budget

```text
POST /api/groups/:groupId/validate-budget
```

### Approval

```text
POST /api/groups/:groupId/approve
POST /api/groups/:groupId/reject
```

### Booking

```text
POST /api/groups/:groupId/book
```

Keep the API simple.

---

# 20. Suggested Database Structure

Use a structure similar to:

```text
groups
  └── groupId
       ├── code
       ├── createdAt
       ├── status
       ├── members
       │
       ├── messages
       │
       ├── currentPlan
       │
       └── approvals
```

Member:

```json
{
  "id": "user123",
  "name": "Thang",
  "budget": 50,
  "approvalStatus": "pending"
}
```

Message:

```json
{
  "senderId": "user123",
  "senderName": "Thang",
  "text": "I don't want to spend more than $50.",
  "timestamp": "..."
}
```

Plan:

```json
{
  "title": "Bowling Night",
  "date": "Saturday",
  "time": "7:00 PM",
  "estimatedTotal": 126,
  "costPerPerson": 42
}
```

---

# 21. Error Handling

Handle these cases gracefully.

### AI API failure

Display:

```text
We couldn't generate a plan right now.

[ Try Again ]
```

Do not crash the application.

### Empty chat

If the user clicks Generate Plan with no messages:

```text
Please add some conversation details before generating a plan.
```

### Invalid budget

Reject:

```text
-50
abc
empty
```

Show:

```text
Please enter a valid spending limit.
```

### Missing group

If a group code does not exist:

```text
Group not found.
Please check the group code.
```

### Booking before approval

Prevent it on both frontend and backend.

The backend must verify:

```text
every member.approvalStatus === "approved"
```

before allowing booking.

---

# 22. Basic Test Cases

Implement enough validation to pass these scenarios.

## Test 1: Normal Plan

Input:

```text
3 people

Thang: $50
Sarah: $60
Mike: $60

Plan cost: $42/person
```

Expected:

```text
Everyone is within budget.
Everyone can approve.
Booking succeeds after everyone approves.
```

---

## Test 2: One Person Over Budget

Input:

```text
Thang: $50
Sarah: $60
Mike: $40

Plan cost: $42/person
```

Expected:

```text
Thang ✓
Sarah ✓
Mike ⚠

Mike must explicitly approve.
```

---

## Test 3: Over-Budget User Rejects

Input:

```text
Mike limit: $40
Plan cost: $55
```

Mike clicks:

```text
Reject
```

Expected:

```text
Plan cannot be booked.
Plan returns to modification/planning.
```

---

## Test 4: Everyone Approves

Input:

```text
Thang ✓
Sarah ✓
Mike ✓
```

Expected:

```text
Book & Split Cost becomes enabled.
Clicking it creates a booking confirmation.
```

---

## Test 5: One Person Has Not Approved

Input:

```text
Thang ✓
Sarah ✓
Mike pending
```

Expected:

```text
Booking remains disabled.
```

The backend must also reject a booking request.

---

## Test 6: AI Extraction

Conversation:

```text
Let's go bowling Saturday after 6.
I don't want to spend more than $50.
```

Expected extracted information:

```text
Activity: Bowling
Date: Saturday
Time: After 6 PM
Budget: $50
```

---

## Test 7: Missing Information

Conversation:

```text
Let's do something this weekend.
```

Expected:

```text
AI requests clarification.

Example:
"What day works for everyone?"
```

The AI should not invent a date.

---

## Test 8: Invalid Budget

Input:

```text
Budget: -50
```

Expected:

```text
Error:
Please enter a valid spending limit.
```

---

# 23. Security / API Keys

Never expose:

```text
GROK_API_KEY
Firebase private credentials
Stripe secret keys
Google API private keys
```

in frontend code.

Use `.env` files.

Add `.env` to `.gitignore`.

Provide:

`.env.example`

Example:

```text
GROK_API_KEY=
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
STRIPE_SECRET_KEY=
GOOGLE_PLACES_API_KEY=
```

Only include variables that are actually needed.

---

# 24. UI Requirements

The UI should feel like a modern hackathon demo.

Prioritize:

* Clean layout
* Clear buttons
* Good spacing
* Easy-to-read budget information
* Obvious approval status
* Clear AI-generated plan
* Strong success/confirmation screen

Use cards for:

* Group members
* Chat
* Generated plan
* Budget status
* Approval status
* Booking confirmation

Do not spend excessive time on animations.

---

# 25. Demo Scenario

The application must support this exact demo scenario:

### Step 1

Create group:

```text
Thang
Budget: $50
```

### Step 2

Add:

```text
Sarah
Budget: $60

Mike
Budget: $40
```

### Step 3

Chat:

```text
Thang:
What should we do Saturday?

Sarah:
I'd like something active.

Mike:
I'm down for bowling.

Thang:
I don't want to spend more than $50.

Sarah:
I'm free after 6.

Mike:
My max is $40.
```

### Step 4

Click:

```text
Generate Plan
```

### Step 5

AI generates something similar to:

```text
Bowling
Saturday
7 PM

Estimated cost: $42/person
```

### Step 6

Budget validation shows:

```text
Thang $42 / $50 ✓
Sarah $42 / $60 ✓
Mike $42 / $40 ⚠
```

### Step 7

Mike sees:

```text
Your spending limit: $40
Estimated cost: $42

$2 over budget.

[ Approve Anyway ]
[ Reject ]
```

### Step 8

Mike approves.

Now:

```text
Thang ✓
Sarah ✓
Mike ✓
```

### Step 9

Click:

```text
Book & Split Cost
```

### Step 10

Show:

```text
🎉 Booking Confirmed

Bowling
Saturday • 7 PM

Thang: $42
Sarah: $42
Mike: $42

Payment: Simulated
```

This is the primary success path.

---

# 26. Development Priority

Work in this order:

### Priority 1 — MUST WORK

1. React application
2. Group creation
3. Add members
4. Spending limits
5. Chat
6. Grok integration
7. Structured AI plan
8. Budget calculation
9. Approval system
10. Simulated booking

### Priority 2 — NICE TO HAVE

11. Firebase persistence
12. Google Places
13. Stripe test mode
14. Better animations
15. Better error states

If time becomes limited, stop adding features and make Priority 1 reliable.

---

# 27. Definition of Done

The project is considered complete when a judge can:

1. Create a group.
2. Add multiple people.
3. Set different spending limits.
4. Enter a natural group conversation.
5. Click Generate Plan.
6. See AI turn the conversation into a structured plan.
7. See individual costs.
8. See who is within/outside their budget.
9. Have an over-budget user explicitly approve.
10. Have everyone approve.
11. Click Book & Split Cost.
12. See a polished booking confirmation.

The entire flow should work without manually editing the database or code.

---

# 28. Final Instruction

Start by inspecting the existing project structure.

If the project is empty, initialize the required React/Vite frontend and Node/Express backend.

Do not rewrite existing working code unnecessarily.

Build the smallest working version first.

After each major feature, make sure the application still runs.

Do not stop at generating files or scaffolding. Actually implement the functionality.

At the end, provide:

1. How to install dependencies.
2. Environment variables required.
3. How to run frontend.
4. How to run backend.
5. How to test the primary demo flow.
6. Any features that were intentionally left simulated or incomplete.

Most importantly:

**Prioritize a working 20-hour hackathon MVP over production-level architecture.**
