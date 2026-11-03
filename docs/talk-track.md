# Talk track

The say-aloud lines for each story, as they appear in the app (StoryPanel). Choose the vertical in the panel; the cast names follow it. Every story has an Allowed path and, where it exists, a Blocked path.

## S05 — A tool changed overnight

Goal: {{lena}} uses an assistant with a stock-price tool that {{vocab.org}} approved last week. It should keep doing exactly what was approved.

Control: A pinned client hashes each tool's name, description and input schema when {{mark}} approves it, and refuses any tool whose hash changes.

### 1. Approve the clean list

Say: “Approval is a snapshot. We keep the fingerprint of what was approved.”

Why it matters: Without a recorded fingerprint there is nothing to compare tomorrow's list against.

### 2. Come back later

Say: “Same server, same tool name, same URL. Nothing in the protocol raised a hand.”

Why it matters: MCP has no signal for changed metadata, so the client has to notice.

### 3. Compare

Say: “The ungoverned client trusted the server because it trusted it yesterday.”

Why it matters: Trust on first use is only safe if the first use is checked again every time after.

On the blocked path, say: “The tool is refused until {{mark}} looks at the diff and approves it again.”

### 4. Read the diff

Say: “A hash tells us something changed. The diff tells us what.”

Why it matters: A reviewer needs the change, not just an alarm.

### 5. Say what pinning does not catch

Say: “Pinning catches the change. It cannot catch what was already wrong when we said yes.”

Why it matters: Overstating a control is how it gets trusted past what it can do.

## S14 — The description told the agent to move money

Goal: {{lena}} asks the assistant a harmless question and expects an answer, not a payment to {{vocab.desk}}'s outside account.

Control: Vet tool metadata before it is approved (a scanner or a person), pin it so it cannot change after, and put runtime controls on what the dangerous tools may do.

### 1. A harmless question

Say: “She asked about the weather. Nobody asked about money.”

Why it matters: The user's request and the model's instructions come from different places.

### 2. The assistant obeys the description

Say: “The description is an instruction to the model and the model follows it.”

Why it matters: The model cannot tell tool documentation from tool orders.

### 3. Pinning does not help on day one

Say: “Pinning remembers what we approved. It did not read it.”

Why it matters: This is the honest limit: someone has to vet the first list.

On the blocked path, say: “The vetting step belongs before approval, and it is a different control from pinning.”

### 4. Stop the call itself

Say: “Assume some poison gets through, and make the dangerous call hard to make.”

Why it matters: Detection fails sometimes. Authority is the last line.

## S36 — One listing, checked twice

Goal: {{lena}}'s assistant should see only the tools {{lena}} may use, from every server {{vocab.org}} connected, under names that cannot collide.

Control: An aggregate gateway prefixes every tool with its member's alias, lists only what the caller is entitled to and the aggregate policy allows, and asks the same question again when a call is forwarded to a member. It does not read or clean what a tool says.

### 1. No gateway: everything is listed

Say: “With no gateway the client does the merging, and the last definition of a name wins.”

Why it matters: The bank's tool and the hostile one look the same by name.

On the blocked path, say: “The prefix is what keeps one server from taking another's name.”

### 2. Filter by what this caller may see

Say: “The listing is different for every caller, because it is filtered by who is asking.”

Why it matters: A tool the caller cannot see is a tool a hostile description cannot talk the model into using.

### 3. Cap what the aggregate allows

Say: “The cap is the most anyone can ever see, whatever they were granted.”

Why it matters: One cap over every member is easier to reason about than a rule per server.

### 4. A tool that appears after approval

Say: “A tool that shows up later is removed unless someone entitled it and capped it in.”

Why it matters: Approval was about a list. The gateway enforces that list again on every call.

### 5. The filter does not clean content

Say: “The gateway decides who sees a tool. It does not read it.”

Why it matters: Overstating a control is how it gets trusted past what it can do.

### 6. A member that is down is reported

Say: “Missing and unreachable are not the same thing, and the gateway says which.”

Why it matters: A silent gap looks like a clean list.

