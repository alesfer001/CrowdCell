# Decentralized Kickstarter on CKB - Project Plan

## Project Overview

A decentralized crowdfunding platform on Nervos CKB blockchain, enabling trustless campaign creation, pledging, and automatic fund distribution based on campaign success/failure.

**Target:** MVP launch to qualify for CKB Community Fund DAO grant

---

## MVP Scope

### Core Features
1. Campaign creation with funding goal and block-height deadline
2. Pledge functionality with locked funds
3. Automatic state resolution (success/failure)
4. Fund claiming for successful campaigns (creators)
5. Refund claiming for failed campaigns (backers)
6. Campaign discovery and listing UI
7. Real-time campaign progress tracking

### Technical Stack
- **Blockchain:** Nervos CKB
- **On-chain Logic:** Type Scripts (Rust/C)
- **Off-chain:** TypeScript with Lumos framework
- **Frontend:** React/Next.js (recommended)
- **Token:** CKB native token only

### Funding Model
- All-or-nothing (Kickstarter style)
- Pledges locked until campaign resolution
- Block-height based deadlines
- No campaign modifications after launch

---

## Architecture Overview

### On-Chain Components

#### 1. Campaign Cell
```
Capacity: Variable (holds pledged funds)
Lock Script: Campaign Lock (controls fund release)
Type Script: Campaign Type (validates state transitions)
Data:
  - creator_lock_hash
  - funding_goal (amount in CKB)
  - deadline_block
  - total_pledged
  - status (active/successful/failed)
  - metadata_hash (links to off-chain description)
```

#### 2. Pledge Cell
```
Capacity: Pledge amount + storage
Lock Script: Pledge Lock (allows refund or transfer to creator)
Type Script: Pledge Type (links to campaign)
Data:
  - campaign_id (hash of campaign cell)
  - backer_lock_hash
  - amount
  - timestamp_block
```

#### 3. Campaign Type Script
**Validates:**
- Campaign creation (valid parameters, sufficient capacity)
- Pledge additions (campaign still active, valid amounts)
- Campaign finalization (deadline reached, goal met/not met)
- Fund claiming (only creator if successful, only backers if failed)

### Off-Chain Components

#### 1. Frontend Application
- Campaign creation form
- Campaign listing/browsing
- Campaign detail page with progress bar
- Pledge/contribution interface
- User dashboard (campaigns created, campaigns backed)
- Claim funds/refunds interface

#### 2. Indexer Service
- Monitors CKB blockchain for campaign/pledge cells
- Aggregates campaign statistics
- Provides API for frontend queries
- Caches IPFS metadata

#### 3. Metadata Storage
- IPFS for campaign descriptions, images, updates
- On-chain stores only IPFS hash for immutability

---

## Detailed Task Breakdown

### Phase 1: Project Setup & Research (Week 1)

#### Task 1.1: Development Environment Setup
- [ ] Install CKB node (testnet)
- [ ] Install CKB-CLI
- [ ] Set up Rust development environment
- [ ] Install Capsule (CKB script development framework)
- [ ] Set up TypeScript/Node.js environment
- [ ] Install Lumos SDK
- [ ] Create project repository structure
- [ ] Set up version control (Git)

#### Task 1.2: CKB Fundamentals Study
- [ ] Review CKB cell model documentation
- [ ] Study Lock Script vs Type Script differences
- [ ] Understand CKB transaction structure
- [ ] Review capacity calculation mechanisms
- [ ] Study existing CKB dApps as reference
- [ ] Learn Lumos transaction building

#### Task 1.3: Architecture Documentation
- [ ] Finalize cell structure design
- [ ] Document state machine (campaign lifecycle)
- [ ] Design transaction flow diagrams
- [ ] Define error handling strategy
- [ ] Create security considerations document

---

### Phase 2: Smart Contract Development (Weeks 2-4)

#### Task 2.1: Campaign Type Script Development
**Priority: HIGH**

- [ ] Set up Capsule project for Campaign Type Script
- [ ] Define campaign data structure (encoding/decoding)
- [ ] Implement campaign creation validation
  - [ ] Validate funding goal > 0
  - [ ] Validate deadline > current block
  - [ ] Validate creator lock hash
  - [ ] Validate initial capacity
- [ ] Implement pledge acceptance logic
  - [ ] Verify campaign is active
  - [ ] Verify deadline not passed
  - [ ] Update total_pledged counter
- [ ] Implement campaign finalization logic
  - [ ] Check deadline reached
  - [ ] Check if goal met
  - [ ] Update status accordingly
- [ ] Implement fund claiming validation
  - [ ] For successful campaigns: only creator can claim
  - [ ] For failed campaigns: only backers can claim refunds
  - [ ] Prevent double claiming
- [ ] Write unit tests for all validation logic
- [ ] Optimize for gas efficiency

#### Task 2.2: Pledge Type Script Development
**Priority: HIGH**

- [ ] Set up Capsule project for Pledge Type Script
- [ ] Define pledge data structure
- [ ] Link pledge to specific campaign (campaign_id)
- [ ] Validate pledge creation
  - [ ] Verify campaign exists and is active
  - [ ] Verify pledge amount > minimum
  - [ ] Record backer information
- [ ] Implement pledge claiming/refund logic
  - [ ] Verify campaign has ended
  - [ ] Verify backer identity
  - [ ] Calculate refund amount
- [ ] Write unit tests
- [ ] Test integration with Campaign Type Script

#### Task 2.3: Lock Scripts Development
**Priority: MEDIUM**

- [ ] Campaign Lock Script (controls when funds can be moved)
  - [ ] Allow creator withdrawal only if campaign successful
  - [ ] Allow backer refunds only if campaign failed
- [ ] Pledge Lock Script (simpler, delegates to Type Script)
- [ ] Test lock script logic
- [ ] Security audit of lock conditions

#### Task 2.4: Contract Testing & Deployment
**Priority: HIGH**

- [ ] Integration testing on CKB testnet
- [ ] Test full campaign lifecycle (create → pledge → success → claim)
- [ ] Test failure scenario (create → pledge → fail → refund)
- [ ] Test edge cases (zero pledges, exact goal, over-funding)
- [ ] Stress test with multiple concurrent campaigns
- [ ] Deploy to CKB testnet
- [ ] Document contract addresses and code hashes
- [ ] Prepare deployment scripts for mainnet

---

### Phase 3: Off-Chain Infrastructure (Weeks 4-6)

#### Task 3.1: Indexer Service Development
**Priority: HIGH**

- [ ] Set up Node.js/TypeScript project
- [ ] Integrate CKB indexer library
- [ ] Implement campaign cell indexing
  - [ ] Listen for new campaign cells
  - [ ] Parse campaign data
  - [ ] Store in database (PostgreSQL/MongoDB)
- [ ] Implement pledge cell indexing
  - [ ] Track pledges per campaign
  - [ ] Calculate running totals
  - [ ] Track backer information
- [ ] Implement campaign status monitoring
  - [ ] Check block height vs deadline
  - [ ] Update campaign status automatically
- [ ] Create REST API endpoints
  - [ ] GET /campaigns (list all, with filters)
  - [ ] GET /campaigns/:id (single campaign details)
  - [ ] GET /campaigns/:id/pledges (pledges for campaign)
  - [ ] GET /user/:address/campaigns (user's created campaigns)
  - [ ] GET /user/:address/pledges (user's pledges)
- [ ] Implement WebSocket for real-time updates
- [ ] Add caching layer (Redis)
- [ ] Write API documentation

#### Task 3.2: IPFS Integration
**Priority: MEDIUM**

- [ ] Set up IPFS node or use Pinata/Web3.Storage
- [ ] Create metadata schema for campaigns
  ```json
  {
    "title": "Campaign Title",
    "description": "Full description",
    "image": "ipfs://...",
    "category": "Technology",
    "risks": "Potential risks...",
    "timeline": "Project timeline..."
  }
  ```
- [ ] Implement upload functionality
- [ ] Implement retrieval and caching
- [ ] Handle IPFS gateway fallbacks

#### Task 3.3: Transaction Builder Service
**Priority: HIGH**

- [ ] Set up Lumos integration
- [ ] Implement campaign creation transaction builder
  - [ ] Collect inputs (creator's cells)
  - [ ] Build campaign cell with proper structure
  - [ ] Handle capacity calculations
  - [ ] Sign and submit transaction
- [ ] Implement pledge transaction builder
  - [ ] Collect backer's cells
  - [ ] Create pledge cell
  - [ ] Update campaign cell (increment total_pledged)
  - [ ] Handle capacity requirements
- [ ] Implement claim transaction builder (success case)
  - [ ] Verify campaign status
  - [ ] Transfer all pledged funds to creator
  - [ ] Clean up campaign cell
- [ ] Implement refund transaction builder (failure case)
  - [ ] Verify campaign status
  - [ ] Return funds to individual backer
  - [ ] Handle partial refunds if needed
- [ ] Add transaction status tracking
- [ ] Implement error handling and retry logic
- [ ] Write integration tests

---

### Phase 4: Frontend Development (Weeks 6-8)

#### Task 4.1: Project Setup
**Priority: HIGH**

- [ ] Initialize React/Next.js project
- [ ] Set up Tailwind CSS or UI framework
- [ ] Configure routing
- [ ] Set up state management (Context API or Zustand)
- [ ] Integrate wallet connection (CKB wallet)
- [ ] Set up API client (axios/fetch)

#### Task 4.2: Core Pages & Components

**4.2.1: Campaign Creation Page**
- [ ] Create campaign form component
  - [ ] Title input
  - [ ] Description editor (rich text)
  - [ ] Funding goal input (CKB amount)
  - [ ] Duration selector (blocks → show estimated days)
  - [ ] Category selector
  - [ ] Image upload
- [ ] Form validation
- [ ] IPFS upload integration
- [ ] Transaction building and signing
- [ ] Success/error handling
- [ ] Preview mode

**4.2.2: Campaign Listing Page**
- [ ] Campaign card component
  - [ ] Title, image, progress bar
  - [ ] Goal amount, raised amount
  - [ ] Time remaining (blocks → days/hours)
  - [ ] Status badge (active/successful/failed)
- [ ] Grid/list layout
- [ ] Filtering (by status, category)
- [ ] Sorting (newest, ending soon, most funded)
- [ ] Pagination or infinite scroll
- [ ] Search functionality

**4.2.3: Campaign Detail Page**
- [ ] Campaign header (title, image, creator)
- [ ] Progress visualization
  - [ ] Progress bar
  - [ ] Amount raised / goal
  - [ ] Number of backers
  - [ ] Time remaining countdown
- [ ] Full description display
- [ ] Pledge section
  - [ ] Amount input
  - [ ] Pledge button
  - [ ] Wallet connection prompt
- [ ] Backer list (optional, show top backers)
- [ ] Transaction history
- [ ] Share buttons

**4.2.4: User Dashboard**
- [ ] Wallet connection status
- [ ] "My Campaigns" section
  - [ ] List of created campaigns
  - [ ] Status indicators
  - [ ] Claim funds button (for successful campaigns)
- [ ] "My Pledges" section
  - [ ] List of backed campaigns
  - [ ] Status of each
  - [ ] Claim refund button (for failed campaigns)
- [ ] Transaction history
- [ ] Account balance (CKB)

**4.2.5: Claim/Refund Interface**
- [ ] For creators: Claim funds from successful campaigns
  - [ ] Show claimable amount
  - [ ] One-click claim transaction
  - [ ] Transaction status tracking
- [ ] For backers: Claim refunds from failed campaigns
  - [ ] Show refund amount
  - [ ] One-click refund transaction
  - [ ] Batch refund if backed multiple failed campaigns

#### Task 4.3: Wallet Integration
**Priority: HIGH**

- [ ] Integrate JoyID or Nexus wallet
- [ ] Implement wallet connection flow
- [ ] Handle account switching
- [ ] Display connected address
- [ ] Sign transactions through wallet
- [ ] Handle wallet errors gracefully

#### Task 4.4: UI/UX Polish
**Priority: MEDIUM**

- [ ] Loading states for all async operations
- [ ] Error messages (user-friendly)
- [ ] Success confirmations
- [ ] Responsive design (mobile, tablet, desktop)
- [ ] Accessibility (WCAG guidelines)
- [ ] Animation and transitions
- [ ] Empty states (no campaigns, no pledges)
- [ ] Tooltips for blockchain-specific terms

---

### Phase 5: Testing & Quality Assurance (Week 9)

#### Task 5.1: End-to-End Testing
**Priority: HIGH**

- [ ] Test full user flow: create campaign
- [ ] Test full user flow: make pledge
- [ ] Test full user flow: successful campaign → claim funds
- [ ] Test full user flow: failed campaign → claim refund
- [ ] Test wallet connection and signing
- [ ] Test with multiple users simultaneously
- [ ] Test edge cases
  - [ ] Campaign with zero pledges
  - [ ] Campaign that exactly meets goal
  - [ ] Campaign that exceeds goal
  - [ ] Multiple pledges from same user
  - [ ] Pledging to expired campaign (should fail)

#### Task 5.2: Security Audit
**Priority: CRITICAL**

- [ ] Review smart contract code for vulnerabilities
  - [ ] Reentrancy risks
  - [ ] Integer overflow/underflow
  - [ ] Access control issues
- [ ] Review transaction building logic
- [ ] Test for front-running scenarios
- [ ] Verify capacity calculations prevent cell exhaustion
- [ ] Check for potential griefing attacks
- [ ] Document security considerations

#### Task 5.3: Performance Testing
**Priority: MEDIUM**

- [ ] Load test indexer API
- [ ] Test with large number of campaigns (100+)
- [ ] Test with campaigns having many pledges (1000+)
- [ ] Optimize database queries
- [ ] Implement API rate limiting
- [ ] Test IPFS retrieval performance

#### Task 5.4: User Acceptance Testing
**Priority: HIGH**

- [ ] Recruit beta testers from CKB community
- [ ] Prepare test scenarios and instructions
- [ ] Deploy to testnet for public testing
- [ ] Collect feedback via forms/surveys
- [ ] Document bugs and feature requests
- [ ] Iterate based on feedback

---

### Phase 6: Documentation & Deployment (Week 10)

#### Task 6.1: User Documentation
**Priority: HIGH**

- [ ] Write "Getting Started" guide
- [ ] Create campaign creator guide
  - [ ] How to create a campaign
  - [ ] Best practices for success
  - [ ] How to claim funds
- [ ] Create backer guide
  - [ ] How to browse campaigns
  - [ ] How to make pledges
  - [ ] How to claim refunds
- [ ] FAQ section
- [ ] Video tutorials (optional but recommended)
- [ ] Troubleshooting guide

#### Task 6.2: Developer Documentation
**Priority: MEDIUM**

- [ ] Smart contract documentation
  - [ ] Cell structures
  - [ ] Validation rules
  - [ ] State machine diagram
- [ ] API documentation (OpenAPI/Swagger)
- [ ] Architecture diagrams
- [ ] Setup and deployment guide
- [ ] Contributing guide (if open source)
- [ ] Code comments and inline documentation

#### Task 6.3: Mainnet Deployment
**Priority: CRITICAL**

- [ ] Final security review
- [ ] Deploy smart contracts to CKB mainnet
- [ ] Deploy indexer service to production server
- [ ] Deploy frontend to hosting (Vercel/Netlify)
- [ ] Configure production database
- [ ] Set up monitoring and alerts
  - [ ] Server uptime monitoring
  - [ ] Transaction monitoring
  - [ ] Error tracking (Sentry)
- [ ] Set up backup systems
- [ ] Configure CDN for frontend assets
- [ ] Set up domain and SSL certificate

#### Task 6.4: Launch Preparation
**Priority: HIGH**

- [ ] Create landing page with value proposition
- [ ] Prepare announcement posts
  - [ ] CKB Talk forum
  - [ ] Twitter/X
  - [ ] Discord/Telegram
- [ ] Create demo video
- [ ] Prepare press kit
- [ ] Reach out to CKB community leaders
- [ ] Plan launch event/AMA

---

### Phase 7: Grant Application & Post-Launch (Week 11+)

#### Task 7.1: Community Fund DAO Grant Application
**Priority: HIGH**

- [ ] Review grant application requirements
- [ ] Prepare grant proposal document
  - [ ] Project overview and vision
  - [ ] Technical architecture
  - [ ] MVP demonstration
  - [ ] Roadmap for future features
  - [ ] Budget breakdown
  - [ ] Team introduction
  - [ ] Community benefit analysis
- [ ] Prepare demo video/presentation
- [ ] Gather community testimonials
- [ ] Submit application
- [ ] Present to DAO if required

#### Task 7.2: Post-Launch Monitoring
**Priority: HIGH**

- [ ] Monitor for bugs and issues
- [ ] Track user metrics
  - [ ] Number of campaigns created
  - [ ] Total pledges made
  - [ ] Success rate of campaigns
  - [ ] User retention
- [ ] Collect user feedback
- [ ] Respond to support requests
- [ ] Fix critical bugs immediately
- [ ] Plan hotfixes and patches

#### Task 7.3: Community Building
**Priority: MEDIUM**

- [ ] Create social media accounts
- [ ] Set up Discord/Telegram community
- [ ] Regular updates and announcements
- [ ] Feature successful campaigns
- [ ] Engage with users and creators
- [ ] Build partnerships with other CKB projects

---

## Post-MVP Roadmap (For Grant Proposal)

### v1.1: Trustless Automatic Fund Distribution (Priority: Critical)

**Problem:** In the MVP, backers must manually release funds to the creator (on success) or claim refunds (on failure). This creates a critical dependency — a single unresponsive backer can block the creator from receiving funds, and an unresponsive creator can delay refunds by not finalizing.

**Solution:** Custom Pledge Lock Script that enforces fund distribution based on on-chain campaign status, removing the need for backer/creator cooperation.

#### Custom Pledge Lock Script (Rust, RISC-V)
- New lock script for pledge cells replaces standard secp256k1 lock
- On **campaign success**: anyone can spend the pledge cell, but the lock script validates that the output goes to the creator's lock script (stored in campaign cell data)
- On **campaign failure**: anyone can spend the pledge cell, but the lock script validates that the output goes back to the backer's lock script (stored in pledge cell data)
- While **campaign is active**: pledge cell is locked (no one can spend it)
- Lock script reads campaign cell status via cell deps to determine which path is valid

#### Automated Finalization
- Anyone can finalize an expired campaign (not just the creator) — removes creator as bottleneck
- Optionally: batch finalize + release/refund in a single transaction

#### Automation Service (Optional)
- Background bot that watches for finalized campaigns and submits release/refund transactions
- No private keys needed — the custom lock script controls where funds go, the bot just triggers the transactions
- Fallback: any user can trigger release/refund from the UI for any campaign (not just their own)

#### Keeper Tip (Future)
- Today the release/refund fee comes out of the pledge cell's storage overhead (pledge-lock allows up to `MAX_FEE` = 1 CKB), so whoever triggers the tx needs no CKB of its own, but also earns nothing. The only runner is our bot, next to the indexer on Render.
- Idea: let the pledge lock pay a small tip to whoever submits release/refund, out of the backer's overhead. Independent operators then have a reason to run the keeper job, and the app keeps working if our bot goes away.
- Fits psawyerberlin's "Service Runner" proposal on Nervos Talk ([topic 10734](https://talk.nervos.org/t/a-revenue-layer-for-ckb-nodes/10734)), where full nodes would run keeper jobs like this for a fee. CrowdCell offered to be an early use case (2026-09-29).
- Open questions: how big the tip should be relative to the minimum pledge (100 CKB); whether to pay it to a lock in the witness or to an extra output; how to stop a keeper from taking the full `MAX_FEE`. This is a contract change, so it needs a redeploy and review.

#### Creator Reputation via Vellum / did:ckb (Future)
- Suggested by Neon (Telegram, 2026-09-30): each creator (and backer) has a DID profile with a reputation score, which gives a crowdfund more credibility. Today a backer sees only a lock hash and has nothing to judge the creator by.
- Vellum ([topic 10613](https://talk.nervos.org/t/10613), by truthixify, passed as a resubmitted DIS) is the reference dashboard and SDK for did:ckb, extended into reputation: on-chain claim cells, a scoring engine, and a public builder reputation dashboard. Its deliverables already list an issuance UI for ecosystem partners building "POAP, crowdfunding, and gated sub-communities". It builds on `@ckb-ccc/did-ckb`, part of the CCC SDK we already use.
- Two directions: **read** (show a creator's DID and Vellum reputation on the campaign page and card) and **write** (CrowdCell issues claims to Vellum when a campaign is funded and pays out, or when a backer pledges, so reputation reflects real outcomes).
- Off-chain only to start: display and claim issuance need no contract change. Gating campaign creation on reputation would be a later, separate decision.
- **What Vellum has live (M1 report, 2026-09-25, [post 9](https://talk.nervos.org/t/10613/9), shared by Neon):** Claim Cell contracts on testnet (Claim Type plus a DID Lock), the `@usevellum/sdk` npm package (0.1.0) with `readClaims` and `writeClaim`, verified-social claims for GitHub, Discord, Telegram and Bluesky, 7 published v1 schemas, and a scoring dashboard (usevellum.xyz, repo truthixify/vellum).
  - `readClaims` scans for an exact **subject lock**, filterable by issuer and schema. So we can read a creator's claims straight from their campaign's creator lock, with no DID linking step.
  - Claim Type also accepts a plain CKB lock as the subject, not only a DID Lock. So CrowdCell could issue claims to creators and backers using the locks it already knows.
  - `writeClaim` builds an unsigned, balanced tx that the issuer's current did:ckb controller must authorize. So issuing claims would need a CrowdCell issuer DID, signed by our bot or an admin key.
- Open questions: which of the 7 schemas fits "campaign funded and paid out" (or whether we need a new one); how to present a missing reputation without penalising new creators; who pays claim cell capacity. Next step: read the Vellum SDK. Neon recommended @menxui on Telegram (display name "truth", likely truthixify), and a first DM went out 2026-09-30.

#### UI/UX Changes
- "Release to Creator" / "Claim Refund" buttons become "Trigger Release" / "Trigger Refund" — callable by anyone
- Pre-wallet confirmation step showing exact CKB amount before wallet popup
- Batch release/refund: one-click to process all pledges for a campaign

#### Migration Path
- New pledge lock script deployed alongside existing contracts
- New campaigns use the custom lock script; old campaigns continue with manual flow
- No changes to campaign type script or pledge type script

**Why this matters for the grant:** This is the single most important upgrade for making the platform trustless. Without it, the platform requires cooperation between parties, which defeats the purpose of a decentralized crowdfunding platform. Grant reviewers will likely ask about this — the answer is that the MVP validates the core flow, and v1.1 makes it fully trustless with a custom lock script.

### v1.2: Enhanced Features
- Campaign cancellation by creator (with refunds)
- Campaign editing (limited, before first pledge)
- Creator verification badges
- Campaign categories and tagging
- Advanced search and filtering
- Pre-wallet confirmation dialog showing exact CKB amounts
- Early finalization — allow creator to finalize before deadline (e.g., goal already met)

### v1.3: Multi-Token Support
- sUDT integration (stablecoins like USDT/USDC)
- Token selection during campaign creation
- Multi-currency display in UI

### v2.0: Advanced Functionality
- Milestone-based fund release
  - Creators set milestones
  - Backers vote to release funds per milestone
- Stretch goals
- NFT rewards via Spore protocol
- .bit integration for creator identity
- Creator reputation system

### v2.5: DeFi Integration
- Yield farming for pledged funds (before campaign ends)
- Liquidity mining rewards for active users
- Governance token for platform decisions

### v3.0: Cross-Chain
- Bitcoin RGB++ integration
- Ethereum bridge for cross-chain pledges
- Multi-chain campaign visibility

---

## Success Metrics

### MVP Launch
- [ ] 10+ campaigns created in first week
- [ ] 50+ pledges made in first month
- [ ] At least 3 campaigns successfully funded
- [ ] Zero critical security incidents
- [ ] 90%+ uptime

### Grant Qualification
- [ ] Working MVP deployed on mainnet
- [ ] Active user base (50+ unique users)
- [ ] Positive community feedback
- [ ] Clear roadmap for future development
- [ ] Open source code (recommended)

---

## Risk Management

### Technical Risks
- **Smart contract bugs:** Extensive testing, security audits, gradual rollout
- **CKB capacity exhaustion:** Careful capacity calculation, reserve funds
- **Indexer downtime:** Redundant infrastructure, backup systems
- **IPFS content unavailability:** Multiple gateway fallbacks, local caching

### Product Risks
- **Low user adoption:** Marketing, community engagement, creator incentives
- **Campaign fraud:** Verification systems, reputation scores, reporting
- **Regulatory concerns:** Clear ToS, compliance research, legal counsel

### Operational Risks
- **Key team member unavailable:** Documentation, code comments, knowledge sharing
- **Funding shortage:** Bootstrap with minimal infrastructure, apply for grants early
- **Competition:** Focus on unique CKB features, community engagement

---

## Resources & References

### CKB Documentation
- [CKB Docs](https://docs.nervos.org/)
- [Lumos Documentation](https://github.com/ckb-js/lumos)
- [Capsule Framework](https://github.com/nervosnetwork/capsule)

### Example Projects
- [CKB dApp Examples](https://github.com/nervosnetwork/docs.nervos.org/blob/develop/docs/essays/dapps.md)
- Look for existing CKB crowdfunding or governance projects

### Community
- [CKB Talk Forum](https://talk.nervos.org/)
- [Nervos Discord](https://discord.gg/nervos)
- [CKB Dev Telegram](https://t.me/nervosnetwork)

### Tools
- [CKB Explorer](https://explorer.nervos.org/)
- [Neuron Wallet](https://github.com/nervosnetwork/neuron)
- [JoyID Wallet](https://joy.id/)

---

## Next Steps

1. **Immediate (This Week):**
   - Set up development environment
   - Create project repository
   - Begin Phase 1 tasks

2. **Short-term (Next 2 Weeks):**
   - Complete CKB fundamentals study
   - Finalize architecture design
   - Start smart contract development

3. **Medium-term (Month 1-2):**
   - Complete on-chain logic
   - Deploy to testnet
   - Begin off-chain development

4. **Long-term (Month 3):**
   - Complete MVP
   - Deploy to mainnet
   - Apply for grant

---

## Implementation Progress

### Completed

#### Environment & Setup (Plan Phases 1)
- [x] OffCKB local devnet (instead of testnet — faster iteration)
- [x] Rust + riscv64 cross-compilation for on-chain contracts
- [x] TypeScript + CCC library (instead of Lumos — modern CKB SDK)
- [x] Next.js frontend with Tailwind CSS
- [x] Git repository with monorepo structure

#### Smart Contracts (Plan Phases 2)
- [x] **Campaign Type Script** (`contracts/campaign/src/main.rs`)
  - Creation validation (GroupInput=0, GroupOutput=1)
  - Finalization validation (Active → Success/Failed, immutable fields check)
  - Destruction allowed (lock script guards spending)
- [x] **Pledge Type Script** (`contracts/pledge/src/main.rs`)
  - Creation validation (data structure, campaign reference)
  - Destruction allowed (enables refund and release)
  - Modification rejected (pledges are immutable)
- [x] Contracts built for RISC-V, deployed to devnet

**Key design decisions:**
- No custom lock scripts — standard secp256k1 locks are used (backer owns pledge cell → trustless refund). Planned for v1.1: custom pledge lock script for automatic fund distribution (see Post-MVP Roadmap)
- `total_pledged` is always 0 on-chain; real total computed off-chain by indexer
- Finalization does NOT enforce total_pledged vs funding_goal on-chain (off-chain check only)
- Campaign lifecycle: Active → (finalize) → Success/Failed → (destroy) → consumed

#### Transaction Builder (Plan Phase 3.3)
- [x] `createCampaign()` — builds campaign cell with type script
- [x] `createPledge()` — builds pledge cell linked to campaign
- [x] `finalizeCampaign()` — consumes old campaign, creates finalized cell
- [x] `refundPledge()` — consumes pledge, returns CKB to backer
- [x] `releasePledgeToCreator()` — consumes pledge, sends CKB to creator
- [x] CLI lifecycle tests (`test-lifecycle.ts`, `seed-frontend-test.ts`)

#### Indexer (Plan Phase 3.1)
- [x] In-memory indexer using CCC `findCells` (no database yet)
- [x] Campaign + pledge cell indexing with live-cell tracking
- [x] REST API: `/campaigns`, `/campaigns/:id`, `/campaigns/:id/pledges`, `/pledges/backer/:lockHash`, `/tip`
- [x] `effectiveStatus` computation (active, expired_success, expired_failed, success, failed)
- [x] `originalTxHash` tracking for finalized campaigns (pledge linkage after cell outPoint changes)
- [x] Stale data cleanup (maps cleared before re-indexing)

#### Frontend (Plan Phase 4)
- [x] Campaign listing page with progress bars, status badges
- [x] Campaign detail page with funding stats
- [x] Pledge form (amount input, wallet signing)
- [x] Finalize Campaign button (creator, expired Active campaigns)
- [x] Claim Refund button (backer, Failed campaigns)
- [x] Release to Creator button (backer, Success campaigns)
- [x] Devnet mode with auto-connected test accounts
- [x] Polling-based redirect after finalization (replaces fragile timeout)

#### Testing (Plan Phase 5.1 — partial)
- [x] CLI lifecycle test: create → pledge → finalize (success + failure) → refund/release
- [x] Frontend UI test: all 4 flows manually verified on devnet
  - Submit pledge → progress bar updates, pledge appears
  - Finalize campaign → redirects to finalized page with "Funded" status
  - Claim refund → pledge consumed, CKB returned
  - Release to creator → pledge consumed, CKB sent to creator

#### Campaign Metadata (Phase 9)
- [x] Variable-length metadata (title + description) appended after 65-byte campaign cell header
- [x] No contract changes needed (contract only reads first 65 bytes)
- [x] Serializer: `serializeMetadata()` / `getMetadataSize()` for encoding (u16 LE length-prefixed UTF-8)
- [x] Indexer parser: backward-compatible metadata decoding
- [x] Frontend: title/description form fields, displayed on cards and detail pages
- [x] Metadata preserved during finalization (re-serialized into new cell)
- [x] Seed script: cleanup of existing devnet data + sample titles/descriptions

#### UI Polish & UX (Phase 10)
- [x] 6 new utility functions: `getEffectiveStatusLabel`, `getEffectiveStatusColor`, `blocksToTimeEstimate`, `blockToRelativeTime`, `getUniqueBackerCount`, `truncateText`
- [x] Toast notification system (`ToastProvider`, `useToast()` hook, 4 types, auto-dismiss)
- [x] Skeleton loading components (`SkeletonLine`, `SkeletonCard`, `SkeletonDetailPage`)
- [x] Campaign cards: 2-line description preview, effective status badges (5 states), time remaining, backer count
- [x] Home page: parallel fetch (campaigns + pledges + block), skeleton loading, 30s auto-refresh
- [x] Detail page: collapsible campaign ID with copy, backer count heading, relative times, sortable pledges (Recent/Amount), skeleton loading, 15s auto-refresh
- [x] Create form: required title with inline error, character counters (orange near limit), goal >= 100 CKB, deadline > current block, toast notifications
- [x] Polling loops replace all `setTimeout` calls (pledge, refund, release, campaign creation)
- [x] Transaction progress indicator (Submitted → Pending → Confirmed)
- [x] Responsive: mobile-first pledge form reorder, responsive header, touch targets (min-h-44px)
- [x] Devnet account switcher dropdown in header (no restart needed), balance display (15s refresh)
- [x] Wallet error detection ("rejected"/"disconnected" → friendly toast)

#### Production Readiness (Phase 11)
- [x] **Campaign Destruction Flow** (`off-chain/transaction-builder/src/builder.ts`, `types.ts`)
  - `destroyCampaign()` method — consumes finalized campaign cell, returns CKB to creator (no type script output)
  - `DestroyCampaignParams` interface added to types
  - Frontend: "Destroy Campaign & Reclaim CKB" button (visible when creator, campaign finalized, no pledges remain)
- [x] **SQLite-Backed Indexer** (`off-chain/indexer/src/database.ts`, `indexer.ts`, `api.ts`, `index.ts`)
  - `database.ts` — SQLite wrapper (better-sqlite3) with `campaigns`, `pledges`, `indexer_state` tables
  - Atomic `replaceLiveCells()` — deletes all + inserts new in single transaction
  - Background polling every 10s (`startBackgroundIndexing` / `stopBackgroundIndexing`)
  - API routes no longer call RPC per request — reads from DB
  - Graceful shutdown: stops polling + closes DB
  - Configurable via env vars: `DB_PATH`, `POLL_INTERVAL`
- [x] **Code Cleanup & Deduplication**
  - `off-chain/frontend/src/lib/serialization.ts` — shared `u64ToHexLE()`, `u16ToHexLE()`, `serializeMetadataHex()`
  - Removed duplicate definitions from `campaigns/[id]/page.tsx` and `campaigns/new/page.tsx`
  - Added `// DEVNET ONLY` warnings on hardcoded private keys in `constants.ts`
- [x] **Security Review** (`docs/SecurityReview.md`)
  - 5 findings documented with risk levels and resolutions
  - Contract validation summary table
  - Production recommendations
- [x] **Documentation** (`docs/UserGuide.md`, `docs/DeveloperGuide.md`)
  - User guide: all flows step-by-step, devnet testing tips
  - Developer guide: architecture, contract build/deploy, API reference, env vars

### Not Yet Implemented
- [x] **Custom Pledge Lock Script** for automatic fund distribution (v1.1) — completed in Phase 15
- [x] **Security hardening** — all 6 Officeyutong review issues fixed in Phase 16
- [ ] IPFS integration for off-chain metadata storage (images, rich text)
- [x] Real wallet integration (JoyID via CCC connector) — verified on testnet
- [ ] User dashboard (my campaigns, my pledges)
- [x] Testnet deployment — contracts, indexer (Render), frontend (Vercel)
- [x] Testnet redeployment with Phase 16 hardened contracts — deployed 2026-04-20
- [ ] Mainnet deployment
- [ ] Grant application
- [x] Automatic finalization bot (Phase 17) — completed 2026-04-24, devnet-tested 2026-04-27 (10 bugs fixed)
- [ ] Bot testnet deployment (Phase 17.6) — next step: tsc build, fund bot wallet, deploy to Render
- [ ] External security audit (~1100 lines Rust — recommended by Officeyutong)

---

## Next Steps

### Phase 9: Campaign Metadata ✓
Completed. Title and description stored on-chain as variable-length metadata appended after the 65-byte campaign cell header. No contract changes required.

### Phase 10: UI Polish & UX ✓
Completed. All 6 sub-phases implemented and browser-tested.

#### 10.1: Campaign Card Improvements ✓
- [x] Show truncated description preview (2 lines) on listing cards
- [x] Better status badges — 5 distinct states (Active/blue, Expired-Funded/yellow, Expired-Needs Finalization/orange, Funded/green, Failed/red)
- [x] Show time remaining estimate (blocks remaining → "~5m left", "~2h left", "~3 days left")
- [x] Show backer count on cards

#### 10.2: Campaign Detail Page Polish ✓
- [x] Show campaign ID below the title (collapsible/copy-to-clipboard)
- [x] Add backer count alongside pledge list heading ("Pledges (5) from 3 backers")
- [x] Show "Created at block #X (~2 hours ago)" as relative time
- [x] Improve pledge list — relative time per pledge, sortable by Recent/Amount

#### 10.3: Form Validation & Error Handling ✓
- [x] Require title on campaign creation (inline error on blur and submit)
- [x] Character counter for title (X/200) and description (X/2000), orange near limit
- [x] Validate funding goal >= 100 CKB with descriptive inline error
- [x] Validate deadline block > current block with live block display as helper text
- [x] Replace raw error messages with toast notifications

#### 10.4: Loading & Refresh UX ✓
- [x] Replace all `setTimeout` refreshes with polling loops (pledge, refund, release, create)
- [x] Add loading skeletons for campaign cards and detail page
- [x] Show transaction status progress (Submitted → Pending → Confirmed)
- [x] Auto-refresh: 30s on home page, 15s on detail page

#### 10.5: Responsive Design & Layout ✓
- [x] Mobile-friendly campaign cards (single column, tighter padding)
- [x] Responsive detail page (pledge form first on mobile via order-first/lg:order-last)
- [x] Touch-friendly buttons (min-h-[44px])
- [x] Responsive header (gap-3 sm:gap-8, smaller text, flex-wrap)

#### 10.6: Wallet Integration ✓
- [x] Devnet account switcher dropdown in header (no app restart needed)
- [x] Display connected account balance (refreshed every 15s)
- [x] Graceful handling of wallet disconnection/rejection ("Transaction was cancelled" toast)
- [ ] Real wallet connector (JoyID, MetaMask Snap) — already works via CCC connector, not separately tested

### Phase 11: Production Readiness ✓
Completed. All 4 sub-phases implemented.

#### 11.1: Campaign Destruction Flow ✓
- [x] `destroyCampaign()` in transaction builder (consumes campaign cell, plain CKB output to creator)
- [x] "Destroy Campaign & Reclaim CKB" button in frontend (visible when creator, finalized, no pledges)
- [x] Polls until campaign disappears, then redirects to home

#### 11.2: Database-Backed Indexer ✓
- [x] SQLite via `better-sqlite3` (zero infrastructure, single file DB)
- [x] Background polling every 10s (configurable via `POLL_INTERVAL` env var)
- [x] API reads from DB — no more blocking RPC calls per HTTP request
- [x] Data persists across restarts (serves stale data immediately while refreshing)
- [x] Graceful shutdown (stop polling + close DB)

#### 11.3: Security Review + Code Cleanup ✓
- [x] Shared `serialization.ts` module (deduplicated from 2 pages)
- [x] `// DEVNET ONLY` warnings on private keys
- [x] `docs/SecurityReview.md` — 5 findings, risk levels, accepted trade-offs

#### 11.4: User Documentation ✓
- [x] `docs/UserGuide.md` — prerequisites, starting services, all flows, devnet testing
- [x] `docs/DeveloperGuide.md` — architecture, contract build/deploy, API reference, env vars

### Phase 12: End-to-End Test Suite (Devnet) ✓
All scenarios tested via `claude --chrome` browser automation against local devnet. Test scenario files in `e2e/`.

#### Scenario 1: Successful Campaign (Full Lifecycle) ✓
- [x] Create campaign → pledge (2x) → finalize as Success → release both pledges → destroy campaign

#### Scenario 2: Failed Campaign — Refund Flow ✓
- [x] Create campaign with high goal → small pledge → finalize as Failed → claim refund → destroy campaign

#### Scenario 3: Indexer Persistence ✓
- [x] Data survives indexer restart immediately (no delay), API response ~25ms from SQLite

#### Scenario 4: Edge Cases ✓
- [x] Exact goal match (200/200 = 100.0%)
- [x] Zero pledges → finalize as Failed → immediate destroy
- [x] Form validation (required title, goal >= 100 CKB, deadline > current block)
- [x] Duplicate backer pledges (2 pledges, 300 CKB total, 150.0% shown correctly)

#### Scenario 5: Campaign Destruction ✓
- [x] Destroy button hidden while pledges exist
- [x] Destroy button appears after all pledges released
- [x] Campaign removed from listing and direct URL after destruction

**Bug fixed during testing:** Progress percentage was capped at 100% — now shows real value (e.g. 150%) while bar width caps at 100%.

### Phase 13: Testnet Deployment (In Progress)

#### 13.1: Multi-Network Configuration ✓
- [x] `NEXT_PUBLIC_NETWORK` env var controls network selection (`devnet` | `testnet` | `mainnet`, default: `devnet`)
- [x] Per-network contract configs with env var overrides for tx hashes
- [x] Per-network RPC URLs (devnet → localhost, testnet → `ckbapp.dev`, mainnet → `ckbapp.dev`)
- [x] `createCkbClient(network, rpcUrl?)` factory replaces `createDevnetClient()` in both frontend and transaction-builder
- [x] `DevnetContext` is network-aware: creates private-key signer only on devnet, delegates to CCC wallet connector on testnet/mainnet
- [x] Dynamic header badge: Devnet (orange), Testnet (blue), Mainnet (green)
- [x] `DEVNET_ACCOUNTS` only populated when `IS_DEVNET` is true (private keys never loaded on testnet/mainnet)

#### 13.2: Creator Lock Script Resolution ✓
- [x] Indexer extracts creator's full lock script from `cell.cellOutput.lock` during indexing
- [x] Database: new columns `creator_lock_code_hash`, `creator_lock_hash_type`, `creator_lock_args` with auto-migration
- [x] API: returns `creatorLockScript` in campaign responses
- [x] Frontend: `resolveCreatorLockScript()` uses API data first, falls back to devnet account matching

#### 13.3: Deploy Script ✓
- [x] `scripts/deploy-contracts.ts` supports `CKB_NETWORK` and `DEPLOYER_PRIVATE_KEY` env vars
- [x] Waits for tx confirmation on testnet/mainnet (up to 120s)
- [x] Saves deployment artifacts to `deployment/deployed-contracts-{network}.json`
- [x] Prints env var instructions after non-devnet deployment

#### 13.4: Environment & Documentation ✓
- [x] `.env.example` for frontend and indexer
- [x] `docs/TestnetDeployment.md` — step-by-step testnet deployment guide
- [x] Old `devnetClient.ts` files removed (replaced by `ckbClient.ts`)

#### 13.5: Testnet Deployment & Testing ✓
- [x] Obtain testnet CKB from faucet
- [x] Deploy contracts to CKB testnet (Pudge)
- [x] Run full lifecycle test against testnet
- [x] Verify wallet connector works with real wallets (JoyID)

### Phase 14: Community Engagement & Feedback

#### 14.1: CKBuilder Project Submission ✓
- [x] Created issue on [CKBuilder-projects](https://github.com/Nervos-Community-Catalyst/CKBuilder-projects/issues/6) for technical review from CKB core devs
- [x] Detailed project overview, architecture, security review, and deployment info
- [x] Specific feedback requests on: custom pledge lock script design, on-chain deadline enforcement, campaign cell identity (TypeID), indexer infrastructure, batch operations
- [ ] Receive and incorporate technical feedback from reviewers

#### 14.2: Nervos Talk Writeup ✓
- [x] Write project announcement/writeup for [Nervos Talk](https://talk.nervos.org/)
- [x] Posted to CKB Development & Technical Discussion category (tags: CKB, dapp)
- [x] Include: project overview, demo link, architecture summary, roadmap, feedback questions
- [x] Created new testnet campaign with pledge for live screenshots
- [ ] Engage with community feedback
- [ ] Add screenshots and links to post once trust level allows

#### 14.3: External Validation ✓
- [x] Neon (CKB team member) tested deployed app on testnet — funded a campaign and created his own
- [x] Confirmed core flows work end-to-end with real wallet (JoyID)
- [x] Feedback aligned with v1.1 roadmap (custom lock script for trustless escrow)

### Phase 15: v1.1 — Trustless Automatic Fund Distribution

#### 15.1: On-Chain Contracts ✓
- [x] **Pledge Lock Script** (NEW) — Rust lock script enforcing trustless fund routing (330 lines)
  - 72-byte args: campaign_type_script_hash + deadline + backer_lock_hash
  - Since-based deadline enforcement (absolute block number)
  - Campaign cell_dep lookup with type script hash verification
  - 4 spending paths: release (success), refund (failure), fail-safe refund (no cell_dep), merge
  - MAX_FEE = 1 CKB prevents pledge draining
- [x] **Receipt Type Script** (NEW) — Backer proof-of-pledge (208 lines)
  - 40-byte cell data: pledge_amount + backer_lock_hash
  - Creation validation alongside matching pledge cell
  - Destruction validation during refund (amount match)
- [x] **Campaign Type Script Update** — Added TypeID for unforgeable identity
  - `check_type_id(0, 32)` as first validation step
  - CAMP-02 destruction protection documented (off-chain + fail-safe)
- [x] **Pledge Type Script Update** — Allow merge and partial refund patterns (136 lines added)
  - Merge: N inputs → 1 output, same campaign, capacity preserved
  - Partial refund: 1 input → 1 reduced output
  - Checked arithmetic for overflow safety
- [x] **Build System** — Updated `build-contracts.sh` for all 4 contracts
- [x] All 4 contracts compile with `cargo check --features library`

#### 15.2: Off-Chain Integration ✓
- [x] **Transaction Builder** — 4 new operations in existing builder.ts
  - `createPledgeWithReceipt` — pledge cell + receipt cell atomically
  - `permissionlessRelease` — anyone triggers, lock routes to creator
  - `permissionlessRefund` — consumes pledge + receipt, refunds to backer
  - `mergeContributions` — N pledge cells into 1
- [x] **Indexer Updates**
  - New `receipts` SQLite table with indexes
  - Receipt cell polling via RECEIPT_CODE_HASH env var
  - New API endpoints: `/receipts`, `/receipts/backer/:lockHash`, `/receipts/campaign/:campaignId`
  - Campaign responses include `receiptCount`
- [x] **Deployment Script** — Extended for all 4 contracts (campaign, pledge, pledge-lock, receipt)
- [x] **Integration Test** — `test-v1.1-lifecycle.ts` with 3 scenarios (success release, failure refund, merge-then-release)

#### 15.3: Frontend & E2E Testing ✓
- [x] **Campaign Detail Page Overhaul** — Removed 264 lines of manual release/refund code
  - Status badges per pledge: Locked (gray), Releasing (amber), Released (green), Refunded (blue)
  - Receipt info inline with explorer links
  - Distribution status banner (aggregate)
  - No manual release/refund buttons
- [x] **New Types & API** — `PledgeDistributionStatus`, `Receipt` interface, receipt API functions
- [x] **Utilities** — Distribution status labels/colors, explorer URL helper
- [x] **E2E Scenarios** — Scenario 6 (trustless distribution UX) + Scenario 7 (receipt display)

#### 15.4: Testnet Deployment ✓ (Partial — bugs found)
- [x] Deploy v1.1 contracts to CKB testnet (Pudge) — all 4 contracts (campaign, pledge, pledge-lock, receipt)
  - Campaign: `0x6c766909289c2e199243648926d2f9ccfc8c925cb556e30a89499b023d621e39`
  - Pledge: `0x029f1e497444f52bb7e440c65b3712bf0f629880db60d9592568e9a31ce950ce`
  - Pledge-Lock: `0x3bb066cda4600d9709c195f28fb11eca22367d590a6139c5fc3791932df66066`
  - Receipt: `0x67ca84f10c9bf7ecbed480ebedb0f6e380cc6c11825f2f77683b72ffbcaa352f`
- [x] Update Render indexer env vars (5 vars: CAMPAIGN_CODE_HASH, PLEDGE_CODE_HASH, PLEDGE_LOCK_CODE_HASH, RECEIPT_CODE_HASH, CKB_RPC_URL)
- [x] Redeploy Vercel frontend with updated env vars (10 vars: 4 code hashes + 4 tx hashes + API_URL + NETWORK)
- [x] Testnet E2E testing with real JoyID wallets (2 accounts)
- [x] Run `test-v1.1-lifecycle.ts` on devnet — all 3 scenarios pass (success release, failure refund, merge-then-release). Fixed missing `campaignLockContract` param added in Phase 5.
- [ ] Update Nervos Talk thread with v1.1 progress
- [ ] External tester validates full v1.1 lifecycle

**Testnet E2E results (2026-04-03):**

Passed:
- [x] Campaign creation — title, description, goal, deadline all stored correctly
- [x] Pledge with receipt — 600 CKB pledge created receipt cell, indexer picked up both
- [x] Finalization (success path) — "Funded" green badge, distribution status section visible
- [x] Finalization (failure path) — "Failed" red badge, 100/10,000 CKB (1%)
- [x] Home page listing — both campaigns with correct badges, progress bars, stats
- [x] Trustless UI — no manual release/refund buttons, "Locked" badges on pledges
- [x] Receipt display — "Receipt: N CKB" inline with each pledge row, explorer links

Bugs found (must fix before v1.1 is usable):
- [ ] **BUG-1: Finalization not permissionless** — campaign cell uses standard secp256k1 lock (creator's), so only the creator can finalize. Backer gets lock script error code 4. Blocks Phase 16 auto-finalization bot. Fix: custom campaign lock script or alternative approach.
- [ ] **BUG-2: Campaign cell capacity leak** — finalizer receives ~474 CKB excess from campaign cell. Creator's CKB is routed as change to whoever signs the finalize tx instead of preserved.
- [ ] **BUG-3: No distribution trigger in UI** — after finalization, pledges stay "Locked" with "Distribution pending". No buttons to trigger `permissionlessRelease` / `permissionlessRefund`. Neither creator nor backer can receive CKB through the UI. Critical blocker.
- [ ] **BUG-4: Receipt cell cost not shown** — pledging 600 CKB costs ~900 CKB (pledge + ~300 CKB receipt cell). Users confused by wallet showing higher amount. Need cost breakdown in pledge form.
- [ ] **BUG-5: Backer count shows 0** on home page campaign cards (minor indexer issue).

### Phase 15.5: v1.1 Bug Fixes (Required before v1.1 is usable)

#### 15.5.1: Add Distribution Trigger Buttons (BUG-3 — Critical) ✓
- [x] Add "Trigger Release" button on funded campaigns (calls `permissionlessRelease`)
- [x] Add "Trigger Refund" button on failed campaigns (calls `permissionlessRefund`)
- [x] Buttons visible to everyone (not just creator/backer) — permissionless
- [x] Buttons hidden after all pledges distributed (checks live pledge count)
- [x] Fixed: frontend was using hardcoded base capacity instead of actual pledge cell capacity from chain — caused ERROR_INSUFFICIENT_OUTPUT (code 32)

#### 15.5.2: Fix Campaign Cell Capacity (BUG-2) ✓
- [x] `finalizeCampaign()` now fetches original campaign cell capacity from chain
- [x] Creates two outputs: finalized campaign cell (min capacity) + creator change cell (excess)
- [x] Uses `params.campaignData.creatorLockHash` to reconstruct creator lock script

#### 15.5.3: Receipt Cost UX (BUG-4) ✓
- [x] Show estimated total cost in pledge form (pledge amount + pledge cell + receipt cell + fee)
- [x] Live-updating breakdown below amount input, before wallet popup
- [x] Capacity formulas match builder.ts: `max(ceil((8+dataSize+65+65)*1.2), 61) * 1e8`

#### 15.5.4: Permissionless Finalization (BUG-1) ✓
- [x] Root cause documented: campaign cell locked with creator's lock script
- [x] Custom campaign-lock contract implemented (`contracts/campaign-lock/src/main.rs`)
- [x] Lock validates `since_raw >= deadline_block` (raw comparison, no absolute since flag — devnet rejects absolute since)
- [x] `createCampaign()` uses campaign-lock as lock script with 8-byte deadline args
- [x] `finalizeCampaign()` sets since field to raw deadline block number
- [x] Frontend "Finalize" button visible to all users (removed isCreator check)
- [x] All 3 devnet E2E tests pass: success lifecycle, failure lifecycle, non-creator permissionless finalization

#### 15.5.5: Backer Count Fix (BUG-5) ✓
- [x] `getUniqueBackerCount` now uses same linkage pattern as `getPledgesForCampaign` (pledge `campaign_id` is type script hash, not outpoint ID)
- [x] Counts unique backers from both pledges AND receipts tables
- [x] Funding progress preserved after distribution via receipt amount fallback

### Phase 17: Automatic Finalization Bot ✓
Completed. FinalizationBot class integrated into indexer polling loop. See details below.

---

## Notes & Updates

**2026-02-12:** Phase 8 (Claim/Refund Logic) implementation completed
- Contracts restructured for finalization and destruction
- Transaction builder expanded with finalize/refund/release
- Indexer enhanced with effectiveStatus and pledge linkage tracking
- Frontend actions section with role-based buttons

**2026-02-20:** Phase 8 bug fixes and UI testing
- Fixed finalization redirect bug (stale indexer data, broken pledge linkage, fragile timeout)
- Added `originalTxHash` tracking for finalized campaigns
- All 4 UI flows tested and passing on devnet
- Added `NEXT_PUBLIC_DEVNET_ACCOUNT` env var for account switching

**2026-02-20:** Phase 9 — Campaign Metadata
- Title and description stored on-chain after 65-byte header (no contract changes)
- Full-stack: serializer → builder → indexer parser → API → frontend
- Seed script now cleans up existing devnet data before seeding
- Metadata preserved through campaign finalization

**2026-02-25:** Phase 10 — UI Polish & UX
- 2 new components (Toast, Skeleton), 6 new utility functions, 8 files modified
- Effective status badges (5 states), description previews, time estimates, backer counts
- Toast notifications, skeleton loading, polling loops, transaction progress indicator
- Form validation (required title, char counters, goal/deadline validation)
- Devnet account switcher in header, balance display
- Responsive layout (mobile-first pledge form, touch targets, flex-wrap header)
- All features browser-tested and passing

**2026-03-04:** Phase 11 — Production Readiness
- Campaign destruction: `destroyCampaign()` builder method + frontend button (gray, post-finalization)
- SQLite indexer: `better-sqlite3`, background polling (10s), atomic replace, graceful shutdown
- Code cleanup: shared `serialization.ts`, removed duplicates from 2 pages, DEVNET ONLY warnings
- Security review: 5 contract findings documented with risk/resolution in `docs/SecurityReview.md`
- Documentation: `docs/UserGuide.md` and `docs/DeveloperGuide.md` covering all flows and architecture

**2026-03-05:** Phase 12 — E2E Test Suite
- 5 browser-automated test scenarios run via `claude --chrome` (files in `e2e/`)
- All scenarios passed: successful campaign, failed campaign refund, indexer persistence, edge cases, destruction
- Bug fix: progress percentage uncapped (shows real % like 150%, bar width still caps at 100%)

**2026-03-13:** Phase 13 — Testnet Deployment (code changes)
- Multi-network config: `NEXT_PUBLIC_NETWORK` env var (`devnet`/`testnet`/`mainnet`), per-network RPC URLs and contract configs
- `createCkbClient()` factory replaces `createDevnetClient()` — supports devnet (OFFCKB scripts), testnet (CCC built-in), mainnet
- DevnetContext network-aware: private-key signer on devnet only, CCC wallet connector on testnet/mainnet
- Header: dynamic network badge (Devnet/Testnet/Mainnet), account switcher hidden on non-devnet
- Creator lock script: indexer extracts from `cell.cellOutput.lock`, stored in DB, returned via API, used for release-to-creator on testnet
- Deploy script: supports `CKB_NETWORK` + `DEPLOYER_PRIVATE_KEY` env vars, saves artifacts, prints config instructions
- `.env.example` files for frontend and indexer, `docs/TestnetDeployment.md` guide
- 20 files changed, old `devnetClient.ts` removed, all 3 packages compile clean

**2026-03-18:** Phase 13.5 — Testnet Deployment & Testing
- Generated testnet deployer account, funded via Nervos Pudge Faucet (100,000 CKB)
- Deployed campaign + pledge contracts to CKB testnet (Pudge)
- Campaign code hash: `0xb71c1c...ea3fc`, Pledge code hash: `0x423442...bc924`
- Indexer running locally, exposed via ngrok (`castled-maureen-nonmedicative.ngrok-free.dev`)
- Frontend deployed to Vercel (`decentralized-kickstarter-kappa.vercel.app`)
- Fixed: Vercel env vars had trailing `\n` from `echo` piping — switched to `printf`
- Fixed: Tailwind purging dynamic badge classes — added safelist comment
- Added `ngrok-skip-browser-warning` header to centralized `apiFetch()` in `api.ts`
- JoyID wallet connector verified working on testnet
- Full lifecycle tested: create → pledge → finalize (success) → release → destroy
- Failure path tested: create → pledge → finalize (failed) → refund → destroy

**2026-03-25:** Phase 14 — Community Engagement & Feedback
- Created CKBuilder-projects issue (#6) for technical review from CKB core devs
- Feedback requests focus on: custom pledge lock script design, on-chain deadline enforcement, TypeID for campaign cells, batch operations
- Neon (CKB team member) validated deployed app on testnet — confirmed core flows work with JoyID wallet

**2026-03-26:** Phase 14.2 — Nervos Talk Writeup
- Published project announcement to Nervos Talk (CKB Development & Technical Discussion, tags: CKB, dapp)
- Full writeup: problem statement, lifecycle, architecture, tech stack, design decisions, v1.1 roadmap, feedback questions
- Created fresh testnet campaign (500 CKB goal) + 200 CKB pledge for live screenshots
- Saved draft at `docs/NervosTalkPost.md` for reference
- Note: Discourse new-user restrictions blocked links and screenshots — to be added after trust level upgrade

**2026-03-26:** Community Feedback & Infrastructure
- Received responses from Ophiuchus (community) and RetricSu (CKB core team) on Nervos Talk
- RetricSu pointed to joii2020/crowdfunding demo — analyzed for v1.1 lock script design patterns
- Migrated indexer from Cloudflare tunnel to Render free tier (ckb-kickstarter-indexer.onrender.com)
- Updated Vercel frontend NEXT_PUBLIC_API_URL to Render, removed ngrok-skip-browser-warning header

**2026-03-26 – 2026-03-27:** Phase 15 — v1.1 Trustless Automatic Fund Distribution
- Analyzed joii2020/crowdfunding: Contribution-as-Lock-Script pattern, Claim receipt cells, merge design
- Key design decisions: pledge-as-lock-script, separate receipt cells, fail-safe refund, TypeID, permissionless
- Phase 15.1 (On-Chain Contracts): 4 Rust contracts — pledge lock (330 lines), receipt type (208 lines), campaign TypeID update, pledge merge update (136 lines)
- Phase 15.2 (Off-Chain Integration): 4 tx builder operations, indexer receipt tracking, 3 new API endpoints, deployment script, integration test (456 lines)
- Phase 15.3 (Frontend): Campaign detail page overhaul (-264/+81 lines), status badges, receipt display, 2 E2E scenarios
- All 20 v1.1 requirements implemented, all contracts compile
- Remaining: testnet deployment, external validation, Nervos Talk update

**2026-03-31:** Phase 15 — v1.1 Devnet E2E Validation & Bug Fixes
- Ran full v1.1 lifecycle integration tests (`test-v1.1-lifecycle.ts`) on local devnet — all 3 scenarios pass
- **Contract fixes:**
  - `pledge-lock`: Rewrote `validate_merge` to use `Source::Output` with manual lock hash comparison (fixes `GroupOutput` matching issue with `data2` hash type)
  - `pledge-lock`: Prefixed unused `lock_args` params with `_`
  - `receipt`: Removed unused `load_script` import, suppressed `to_bytes` dead code warning
- **Transaction builder fixes:**
  - `createCampaign`: Added TypeID args computation per CKB RFC-0022 — `blake2b(molecule_serialized_first_input || output_index_u64_le)`
  - `finalizeCampaign`: Preserves TypeID args from original campaign cell (fetches from chain)
  - `permissionlessRelease`: Deducts fee from output capacity (within MAX_FEE), no extra signer inputs needed
  - `permissionlessRefund`: Same fee deduction pattern
  - `mergeContributions`: Adds separate fee cell from signer, restores exact capacity on merge output (contract requires exact match)
- **Deploy script fix:** Moved `scripts/deploy-contracts.ts` to `off-chain/transaction-builder/deploy-contracts.ts`, replaced duplicated broken devnet config with shared `createCkbClient`
- All 4 contracts rebuilt and redeployed to devnet with warning-free compilation

**2026-04-01:** Phase 15 — v1.1 Devnet E2E Testing (Scenario 6) & Infrastructure Fixes
- Ran Scenario 6 (v1.1 Trustless Distribution) via `claude --chrome` browser automation
- **Indexer bug fixes:**
  - Changed `scriptSearchMode` from `"exact"` to `"prefix"` for campaign/pledge/receipt cell searches — `"exact"` with empty args skipped cells with TypeID args
  - Added `import "dotenv/config"` to indexer entry point — `.env` file was never being loaded, indexer always used hardcoded v1.0 code hashes
  - Changed `INSERT INTO` to `INSERT OR REPLACE INTO` for campaigns/pledges/receipts — individual insert failures no longer roll back the entire batch
  - Wrapped `replaceLiveCells` call in try-catch for resilience
  - Installed `dotenv` dependency
- **Frontend fix:**
  - Cleaned up `.env.local` with correct v1.1 contract code hashes and tx hashes after fresh deploy — stale env vars from previous devnet runs caused `TransactionFailedToResolve` errors
- **Contract redeployment:**
  - Deployed all 4 v1.1 contracts to fresh devnet via `deploy-contracts.ts`
  - Updated both frontend `.env.local` and indexer `.env` with new deployment tx hashes
- **Scenario 6 results — all 5 steps passed:**
  - Step 1: Created "Quick Trustless Test" campaign (200 CKB goal, short deadline) ✓
  - Step 2: Pledged 250 CKB as Account #1 — "Locked" badge visible, no manual buttons ✓
  - Step 3: Finalized after deadline — status changed to "Funded" (green) ✓
  - Step 4: "Distribution Status" section visible with automatic/permissionless text ✓
  - Step 5: As backer (Account #1) — no "Claim Refund" or "Release to Creator" buttons ✓

**2026-04-03:** Phase 15 — v1.1 Full E2E Devnet Validation (All 7 Scenarios)
- Ran `test-v1.1-lifecycle.ts` on devnet — all 3 transaction-level scenarios pass (success release, failure refund, merge-then-release)
- Ran all 7 browser E2E scenarios via `claude --chrome` on devnet — **all pass**
- **Indexer bug fixes:**
  - `getCurrentBlockNumber`: Replaced `client.getTip()` with direct JSON-RPC call — CCC's `ClientPublicTestnet.getTip()` returns the testnet tip even when configured with a custom devnet URL
  - `getReceiptsForCampaign`: Added `originalTxHash` linkage (mirroring pledge lookup) — receipts were not found after finalization because the campaign outpoint changes
- **Browser E2E results:**
  - Scenario 1 (Successful Campaign Lifecycle): create → pledge 300 CKB → pledge 250 CKB → finalize as Success → verify no manual buttons ✓
  - Scenario 2 (Failed Campaign Refund): create → pledge 100 CKB (1% of 10,000 goal) → finalize as Failed → verify no manual refund buttons ✓
  - Scenario 3 (Indexer Persistence): campaign + pledge + receipt data survives indexer restart, available immediately ✓
  - Scenario 4 (Edge Cases): exact goal match (200/200 = 100.0%) ✓, zero pledges → finalize → destroy ✓, form validation (empty title, goal < 100, deadline in past) ✓
  - Scenario 5 (Campaign Destruction): destroy button appears after finalize with 0 pledges, campaign removed from listing and direct URL ✓
  - Scenario 6 (Trustless Distribution): "Locked" badges, "Distribution Status" section, no manual release/refund buttons ✓
  - Scenario 7 (Receipt Display): "Receipt: N CKB" inline with each pledge row, amounts match ✓
- **v1.1 core requirements validated:**
  - Receipt info appears inline with each pledge row
  - No manual "Release to Creator" or "Claim Refund" buttons exist
  - "Distribution Status" section appears after finalization
  - Fund distribution described as automatic/permissionless
  - "Locked" status badges on pledge rows

**2026-04-09:** Phase 5 — Permissionless Finalization (Campaign Lock Script)
- Created `contracts/campaign-lock/` — minimal lock script that validates `since_raw >= deadline_block` from 8-byte LE args
- **Key discovery:** CKB OffCKB devnet rejects absolute since values (bit 63 set) with `Immature` error regardless of tip block. Switched to raw deadline block number as since value (same pattern as pledge-lock). Lock script enforces deadline via `load_input_since()`.
- `createCampaign()` now uses campaign-lock as the cell's lock script (replaces creator's secp256k1 lock)
- `finalizeCampaign()` sets `since: BigInt(deadlineBlock)` on the campaign cell input
- Frontend: removed `isCreator` check from finalize button — visible to all users when campaign expired
- Added `campaignLock` to frontend `CONTRACTS` constants
- Test 3 (non-creator finalization): Account B finalizes after deadline, triggers permissionless release — funds routed to creator without creator participation
- All 3 devnet E2E tests pass: success lifecycle, failure lifecycle, non-creator permissionless finalization
- BUG-1 resolved — unblocks Phase 16 (auto-finalization bot)

**2026-04-13:** E2E Integration Testing — Frontend + Indexer campaign-lock fixes
- **Frontend campaign creation** (`campaigns/new/page.tsx`): now creates campaigns with campaign-lock (was using creator's secp256k1 lock, preventing non-creator finalization)
- **Frontend finalization** (`campaigns/[id]/page.tsx`): preserves campaign-lock on output, sets `since = deadline`, adds campaign-lock cell dep (was replacing lock with user's secp256k1 and missing since field)
- **Indexer creatorLockScript extraction** (`indexer.ts`): now resolves creator's lock from the original creation tx outputs (was reading the campaign cell's own lock, which is now campaign-lock instead of creator's secp256k1)
- **Test lifecycle** (`test-lifecycle.ts`): loads contract hashes from `deployed-contracts-devnet.json` instead of hardcoding; added Test 4 (v1.1 permissionless refund lifecycle)
- **Frontend `.env.local`**: added `NEXT_PUBLIC_CAMPAIGN_LOCK_CODE_HASH` and `NEXT_PUBLIC_CAMPAIGN_LOCK_TX_HASH`
- **CLI E2E results (4/4 pass):** success lifecycle, failure lifecycle, non-creator permissionless finalization, v1.1 permissionless refund
- **Browser E2E results (2/2 pass):**
  - Success path: create(Account #0) → pledge 250 CKB(Account #1) → non-creator finalize(Account #1) → trigger release(Account #1) → "All pledges released to creator"
  - Failure path: create(Account #0, 10K goal) → pledge 100 CKB(Account #1) → non-creator finalize(Account #1) → trigger refund(Account #1) → "No pledges" (funds returned to backer)

### Phase 16: Security Hardening — Officeyutong Review Fixes ✓

Addressed all 6 issues from CKB core developer Officeyutong's [CKBuilder Projects code review](https://github.com/Nervos-Community-Catalyst/CKBuilder-projects/issues/6). Two HIGH-severity mainnet blockers + four MEDIUM/SMALL hardening items.

#### Issue 1 — Fail-safe Refund Backdoor (HIGH) ✓
- [x] **Root cause:** Pledge-lock `None` branch defaulted to backer refund when campaign cell_dep missing — a backer could destroy the campaign cell and force-refund a successful campaign
- [x] **Fix (pledge-lock):** Replaced `None` fallback with grace period check. Campaign cell_dep mandatory within 1,944,000 blocks (~180 days). After grace period, fail-safe refund allowed for genuinely lost campaigns.
- [x] **Fix (campaign type):** Restricted destruction — Failed campaigns can be destroyed anytime, Success campaigns blocked until grace period expires, Active campaigns cannot be destroyed.
- [x] Constants: `GRACE_PERIOD_BLOCKS = 1_944_000`, `ERROR_CAMPAIGN_CELL_DEP_MISSING = 21`, `ERROR_DESTRUCTION_NOT_ALLOWED = 13`

#### Issue 2 — Receipt Check Too Loose + Refund Not Permissionless (HIGH) ✓
- [x] **Root cause:** Receipt creation only checked `pledge_amount > 0` and `backer_lock_hash != 0` — didn't verify against actual pledge cell. Refund required receipt as input (locked with backer's secp256k1), making it backer-only.
- [x] **Fix (receipt type):** Cross-checks sibling pledge cell via `load_cell_type` code_hash matching. Verifies `pledge_amount == receipt.pledge_amount` AND `pledge.backer_lock_hash == receipt.backer_lock_hash`. Receipt args store pledge contract code hash (32 bytes).
- [x] **Fix (builder):** `permissionlessRefund` no longer requires receipt as input. Refund validated entirely by pledge-lock. Any wallet can trigger.

#### Issue 3 — Partial Refund Doesn't Cross-Check Amount (MEDIUM) ✓
- [x] **Root cause:** `validate_partial_refund` only checked `output.amount < input.amount` — difference could be any value.
- [x] **Fix (pledge type):** Scans transaction inputs for destroyed receipt by code_hash. Asserts `input_amount - output_amount == receipt.pledge_amount`. Pledge type args store receipt contract code hash (32 bytes).
- [x] Constants: `ERROR_REFUND_AMOUNT_MISMATCH = 16`, `ERROR_NO_RECEIPT_IN_INPUTS = 17`

#### Issue 4 — Merge Deadline + Lock Args (MEDIUM) ✓
- [x] **Root cause:** Merge after deadline is wasteful (not harmful — output retains same lock). Lock args comparison is implicit via GroupInput but not explicit.
- [x] **Fix (pledge-lock):** Added explicit lock args verification loop on merge output (defense in depth). Documented CKB since floor constraint (merge timing limitation).

#### Issue 5 — Finalization Since Enforcement (MEDIUM) ✓
- [x] **Root cause:** Campaign type script finalization didn't check the since field — relied entirely on campaign-lock.
- [x] **Fix (campaign type):** Added `load_input_since` check in finalization path. Validates `since >= deadline_block` as defense-in-depth alongside campaign-lock. Also validates reserved bytes [57..65] and metadata tail unchanged during finalization (Issue 6b).

#### Issue 6 — Smaller Items (SMALL) ✓
- [x] **6a — Indexer network client:** Replaced hard-coded `ClientPublicTestnet` with `CKB_NETWORK` env var. Supports devnet (OffCKB overrides), testnet, mainnet.
- [x] **6b — Reserved bytes + metadata:** Finalization validates `old_data[57..65] == new_data[57..65]` and `old_data[65..] == new_data[65..]`.
- [x] **6c — Capacity buffer in UI:** Already fixed in Phase 15.5.3 (BUG-4).

#### Off-Chain Updates ✓
- [x] Transaction builder: `createPledgeWithReceipt` sets cross-referencing args (receipt args = pledge code hash, pledge args = receipt code hash)
- [x] Deploy script: handles all 5 contracts (campaign, pledge, pledge-lock, receipt, campaign-lock)
- [x] Test lifecycle script: updated for receipt-free refund

#### E2E Validation ✓
- [x] All 5 contracts rebuilt, stripped, deployed to devnet with new code hashes
- [x] **Lifecycle tests (3/3 pass):** Success → release, Failure → refund, Merge → release
- [x] **Security attack tests (3/3 rejected):**
  - Attack 1: Refund without campaign cell_dep on Success campaign → **REJECTED** (error code 21)
  - Attack 2: Destroy Success campaign within grace period → **REJECTED** (campaign-lock blocks)
  - Attack 3: Premature finalization before deadline → **REJECTED** (since Immature enforcement)

**Bug found during E2E testing:** Receipt and pledge contracts used `load_cell_type_hash` (returns hash of full type script including args) but compared against a code hash in args. Fixed by switching to `load_cell_type` with `code_hash()` field comparison.

**Code review findings (advisory):** 2 critical (non-null assertion in builder, silent indexer failure), 4 warnings (hardcoded lock script code hash, empty catch blocks, type safety). See `06-REVIEW.md`.

### Phase 17: Automatic Finalization Bot ✓

**Problem:** After the deadline passes, someone must manually click "Finalize Campaign" to transition the on-chain status. While this is permissionless (anyone can do it), it still requires a manual trigger. This creates friction — campaigns sit in "Expired - Needs Finalization" state until someone acts.

**Solution:** A lightweight background service that monitors for expired campaigns and automatically submits finalization transactions.

#### Scope
- [x] Background service that polls the indexer for campaigns with `status: Active` and `deadlineBlock < currentBlock`
- [x] Automatically builds and submits `finalizeCampaign` transactions
- [x] Dedicated CKB account funded with a small amount (~10 CKB) for transaction fees (~0.001 CKB per finalization)
- [x] Configurable poll interval and batch size
- [x] Logging and error handling for failed finalizations
- [x] Also triggers `permissionlessRelease` / `permissionlessRefund` after finalization

#### Implementation Details
- **`off-chain/indexer/src/bot.ts`** — `FinalizationBot` class (344 lines)
  - `processPendingFinalizations()` — scans for expired Active campaigns, submits finalization txs
  - `releaseSuccessfulPledges()` — triggers permissionless release for Success campaigns
  - `refundFailedPledges()` — triggers permissionless refund for Failed campaigns
  - `checkBotBalance()` — monitors wallet balance, warns if below configurable threshold (default: 50 CKB)
- **`off-chain/indexer/src/indexer.ts`** — Bot integrated into polling loop via `setBot()` dependency injection
- **`off-chain/indexer/src/index.ts`** — Bot initialized from `BOT_PRIVATE_KEY` env var, gracefully disabled if missing
- All three bot methods run each 10-second polling cycle after `indexAll()`
- Error handling: try-catch per operation, log and retry next cycle (no backoff)
- Bot is optional — indexer runs normally without `BOT_PRIVATE_KEY`

#### Code Review Fixes Applied
- Added missing `campaignCellDep` in refund params
- Replaced hardcoded secp256k1 lock scripts with database-stored backer lock scripts (schema migration included)
- Enhanced error logging with structured context (campaign/pledge IDs, stack traces)

#### Design Notes
- The bot needs no special permissions — finalization is permissionless on-chain
- Transaction fees are negligible (~0.001 CKB each)
- Runs inside the existing indexer process (not a separate service)
- Fail-safe: if the bot is down, users can still finalize manually from the UI

### Future Milestones

Past v1.1 (trustless distribution + automatic finalization bot, both verified on testnet), work is split across multiple milestones rather than a single Phase 18.

#### v1.2 — Trustless Finalization + Platform Fees & Treasury

**Purpose:** Two-part milestone, bundled because they belong together:
1. **Close the v1.1 finalization trust gap.** Today the campaign-type script does not verify the terminal Success/Failed status against actual raised funds — an honest finalizer is currently assumed. v1.2 makes the terminal status fully verifiable on-chain so pledge-lock routing can sit on top of provably correct accounting.
2. **Put a sustainable fee/treasury mechanism in place** so it's ready when volume arrives. At early-mainnet volume, fees fund essentially nothing; the point is to deploy and battle-test the mechanism before it matters financially.

**On-chain accumulator decision (added 2026-05-29 after Arthur's feedback):** Restore `total_pledged` as a real on-chain accumulator (currently held at 0 per the v1.1 design that delegated tracking to the bot). Every pledge tx consumes the campaign cell and produces a new one with `total_pledged += pledge.amount`, enforced by the campaign-type script. At finalize, the script reads `total_pledged` directly and validates `new.status == Success` requires `total_pledged >= funding_goal`; `Failed` requires `total_pledged < funding_goal`. Tradeoff is pledge-time contention (one pledge in flight at a time per campaign), mitigated by frontend auto-retry on `OutPoint not found` (same pattern as the JoyID stale-UTXO retry shipped in Phase 17.7). Alternative considered and rejected: reference-all-pledges-at-finalize-via-cell_deps — submitter can omit pledges to manipulate sum without a separate counter, which is just the accumulator under a different name.

**Locked design decisions (pending community feedback from Nervos Talk):**
- **5% creator-side success fee** (initial rate; adjustable later via config cell). Charged only on successful campaigns. Failed campaigns refund 100% to backers — no platform fee on failure. Initial rate revised up from 3% on RetricSu's feedback (2026-05-21): start at a sustainable number, dial down later if it becomes a barrier; harder to raise once users are anchored on a low rate.
- **Creator-side, not backer-side.** Backer pledges X; X counts toward goal. On success, creator nets `raised × 95%`; 5% routes to treasury.
- **On-chain enforced.** Pledge-lock script requires any success-release tx to include a treasury output ≥ `pledge_amount × fee_bps / 10000`. Skipping the treasury output causes the script to reject. With the v1.2 status accumulator above, this routing now sits on top of a verifiable terminal status — fees can't be routed based on a manipulated Success/Failed decision. Still needs Scalebit + Officeyutong review on the contract code before mainnet.
- **Configurable via a platform config cell.** Fee rate + treasury address live in a singleton cell read via cell_deps, not baked into contract args. Later governance (v1.5+) can adjust the rate without redeploying contracts.
- **Multisig treasury from day one.** CKB secp256k1 multisig (operator + 1-2 trusted community members) until v1.5+ ships governance and custody moves to a DAO-controlled address. Confirmed acceptable by RetricSu (2026-05-21); he noted even solo-developer custody would be acceptable in the early stage, giving flexibility on signer onboarding.
- **UI surface.** Creator sees their net payout on the create-campaign form. Backers see no fee. An About/Fees page explains the model.

**v1.2 phase roadmap (working draft — will be firmed up by `/gsd:new-milestone` roadmapper):**

| # | Phase | Est. dev hours | Cal. weeks @ 4.5h |
|---|-------|----------------|-------------------|
| 8 | Campaign accumulator + on-chain status verification + trust-boundary fixes (M-01, M-02, M-03 from `.planning/v12-pre-review/REVIEW.md`) | 10-15h | 2-3 |
| 9 | Pledge-lock fee enforcement (treasury-output check) + resolve grace-period fee-policy question (D-01 from pre-review) | 6-10h | 1-2 |
| 10 | Config cell contract + deployment | 6-10h | 1-2 |
| 11 | Multisig treasury setup | 3-5h | 1 |
| 12 | Tx-builder + indexer integration (incl. pledge-contention retry) | 10-14h | 2-3 |
| 13 | Frontend (net-payout display, About/Fees page, retry UX) | 4-6h | 1 |
| 14 | Testnet deployment + E2E | 5-8h | 1-2 |
| 15 | External audit (Scalebit + Officeyutong sanity review) | 8-15h fix time | 2-4 calendar |
| 16 | CKB Community Fund DAO grant proposal (drafted/submitted in parallel from Phase 8) | 6-10h | 2-3 calendar |

**Total dev time:** ~55-90 hours hands-on. **Calendar ETA:** ~3.5-4.5 months at 4.5 h/week with some parallelism (grant drafting runs alongside engineering, audit elapsed time overlaps with frontend/E2E).

**Budget envelope (working draft, target $20k total):**

| Line | Range | Notes |
|------|-------|-------|
| Engineering (Phases 8-14) | $10-14k | 55-90h at sustainable rate; aligned with engineering portions of CKBoost ($20k/3mo), Pocket Node ($15k/4mo), Fiber Link ($20k/8wk) |
| Audit (Phase 15, Scalebit) | $6-8k | Calibrated to phroi data point (2026-05-29): Scalebit iCKB audit was $4k for 3 scripts; v1.2 touches ~5 scripts so ~$6-8k. Refine once Scalebit quote received. |
| Infra + treasury seeding | $500-1k | Render/Vercel paid-tier headroom + small CKB for treasury bootstrap |
| Buffer (~15%) | $2-3k | Standard contingency |
| **Total ask** | **~$20k** | Aligned with peer high-end; below the credibility cliff |

**Disbursement structure to match peer precedent:** 10% commencement + 4 milestone payments + final 10% on mainnet launch.

**Open action items before grant submission:**
1. Email Scalebit for quote with v1.2 contract scope to lock the audit line
2. Generate CKB grant wallet address
3. Draft proposal against `docs/grant/community-dao-template-developers.md` (English first, Chinese follow-up)

#### v1.3 — Rebrand to CrowdCell
"Decentralized Kickstarter" isn't usable on mainnet for trademark reasons. Name **CrowdCell** picked 2026-06-01 — plays on "Crowd-Sell" (what a creator does, selling an idea to the crowd) with "cell" substitution to make the CKB-native nature explicit. Frontend pass (UI strings, page titles, meta tags, favicon, logo), repo + Render + Vercel service rename, Nervos Talk + CKBuilder Projects updates. Subject to a domain + trademark availability check during execution; fallback naming via community input if "CrowdCell" is unavailable.

#### v1.4 — User Dashboard & UI/UX Improvements
Creator dashboard ("My campaigns" — list, status, raised, action links), backer dashboard ("My pledges" — list, status, outcomes, claim links), indexer endpoints for wallet-aware queries, mobile responsiveness QA, onboarding polish.

**Superseded 2026-09-10:** the bundle below was split after the DIS stalled. v1.3 + v1.4 plus the rest of Phase 8 now form a ~$5k testnet productisation proposal; fees/treasury (v1.2 Phases 9-11), audit and mainnet move to a later proposal. See the 2026-09-10 entry.

**Bundled into the grant proposal.** v1.2, v1.3, and v1.4 are all bundled into the CKB Community Fund DAO grant ask as a single "mainnet launch" milestone (decided 2026-06-01). Rationale: a grant should mean shipping to mainnet, mainnet requires a legally-safe name, and a credible product surface requires the dashboards. Cannot reasonably split into separate proposals.

#### v1.5+ — Platform Token, Governance, Staking
Governance token launch. Treasury custody transitions from multisig to DAO-controlled address. Fee rate becomes governable via the config cell already in place since v1.2.

#### v2 — BTC / RGB++ Integration
Bridge to BTC holders via RGB++ so non-CKB-native users can back campaigns. Largest UX investment of the roadmap.

#### Dropped / Deferred Indefinitely
- **Fiber subscriptions** — Patreon-style ongoing pledges via Fiber payment channels. Raised by Neon in private discussion, flagged in the Nervos Talk proposal for community signal. RetricSu pushed back (2026-05-21): "prove basic needs are met for the launchpad first, then consider advanced features like that". Dropped from scope; revisit only if launchpad use case is solid.

**2026-04-06:** Phase 15.5 — v1.1 Bug Fixes
- Fixed all 5 bugs from testnet E2E testing
- BUG-3 (Critical): Added "Trigger Release"/"Trigger Refund" buttons to campaign detail page — permissionless, any wallet can trigger
  - Fixed frontend capacity calculation: was using hardcoded base capacity instead of actual cell capacity from chain (ERROR_INSUFFICIENT_OUTPUT code 32)
  - Buttons hidden after all pledges distributed (checks live pledge count, not receipt count)
- BUG-2: `finalizeCampaign` now creates 2 outputs — excess capacity returned to creator via change cell
- BUG-4: Pledge form shows live cost breakdown (pledge + pledge cell + receipt cell + fee) before wallet popup
- BUG-1: Fixed — custom campaign-lock contract deployed, non-creator finalization working on devnet (3 E2E tests pass)
- BUG-5: `getUniqueBackerCount` fixed — was using SQL with wrong ID format (outpoint vs type script hash), now uses same linkage pattern as other pledge/receipt queries
- Additional fix: funding progress and backer count preserved after release/refund via receipt amount fallback (pledge cells consumed in UTXO model)

**2026-04-03:** Phase 15.4 — v1.1 Testnet Deployment & E2E Testing
- Generated new testnet deployer account, funded via Nervos Pudge Faucet (100,000 CKB)
- Deployed all 4 v1.1 contracts to CKB testnet (campaign, pledge, pledge-lock, receipt)
- Updated Render indexer env vars (5 vars) and Vercel frontend env vars (10 vars) via CLI
- Testnet E2E testing with 2 real JoyID wallets:
  - Campaign creation: "v1.1 Testnet E2E Test" (500 CKB goal) ✓
  - Pledge with receipt: 600 CKB pledge (120% funded), receipt cell created ✓
  - Finalization (success): status → "Funded" green badge, distribution status visible ✓
  - Failed campaign: "v1.1 Failed Campaign Test" (10,000 CKB goal, 100 CKB pledge → 1%) ✓
  - Finalization (failure): status → "Failed" red badge ✓
  - Home page listing: both campaigns with correct badges, progress, stats ✓
  - Trustless UI: no manual release/refund buttons, "Locked" badges, receipt display ✓
- 5 bugs found — see Phase 15.5 for details:
  - BUG-1: Finalization not permissionless (only creator can finalize)
  - BUG-2: Campaign cell capacity leaks to finalizer (~474 CKB)
  - BUG-3: No distribution trigger UI (funds stuck after finalization) — CRITICAL
  - BUG-4: Receipt cell cost not shown in pledge form (user confusion)
  - BUG-5: Backer count shows 0 on home page cards (minor)

**2026-04-20:** Phase 16 — Security Hardening (Officeyutong Review Fixes)
- Addressed all 6 issues from CKB core developer Officeyutong's code review (2 HIGH, 4 MEDIUM/SMALL)
- Issue 1 (HIGH): Closed fail-safe refund backdoor — grace period (1.9M blocks ≈ 180 days) + campaign destruction protection
- Issue 2 (HIGH): Hardened receipt creation (pledge cross-check by code_hash) + made refund fully permissionless (receipt no longer consumed)
- Issue 3: Partial refund amount cross-checked against destroyed receipt's pledge_amount
- Issue 4: Merge path lock args validation + timing documentation
- Issue 5: Campaign finalization enforces since >= deadline_block (defense in depth)
- Issue 6: Indexer network-aware client, reserved bytes + metadata validation during finalization
- Bug found during E2E: `load_cell_type_hash` vs `code_hash` mismatch in receipt/pledge cross-check — fixed with `load_cell_type` + `code_hash()` comparison
- All 5 contracts rebuilt, deployed to devnet — 3/3 lifecycle tests pass, 3/3 attack scenarios rejected
- Code review: 2 critical (advisory), 4 warnings — see 06-REVIEW.md
- Next: external audit

**2026-04-24:** Phase 17 — Automatic Finalization Bot
- Implemented `FinalizationBot` class in `off-chain/indexer/src/bot.ts` (344 lines)
- 4 core methods: `processPendingFinalizations`, `releaseSuccessfulPledges`, `refundFailedPledges`, `checkBotBalance`
- Integrated into indexer polling loop — bot runs automatically on each 10-second cycle after `indexAll()`
- Bot initialized from `BOT_PRIVATE_KEY` env var in `index.ts`; gracefully disabled if key missing
- TransactionBuilder adapted to 6-parameter constructor for bot usage
- Code review: 2 critical + 3 warnings found and fixed:
  - Added missing `campaignCellDep` in permissionless refund params
  - Replaced hardcoded secp256k1 lock scripts with database-stored backer lock scripts (DB schema migration)
  - Enhanced all error catch blocks with structured logging (campaign/pledge IDs, stack traces)
- Verification: 9/9 must-haves passed
- Remaining: deploy to Render with `BOT_PRIVATE_KEY` env var, fund bot wallet on testnet

**2026-04-27:** Phase 17.5 — Bot Local Devnet Testing & Bug Fixes
- Ran bot E2E on local devnet. Full lifecycle verified: create campaign → pledge → deadline passes → bot auto-finalizes as Success → bot auto-releases pledge funds to creator.
- **10 bugs found and fixed during testing:**
  1. **Stale `.js` files** in `transaction-builder/src/` — Node.js loaded old compiled JS instead of TS source. Deleted all `.js` from `src/`.
  2. **Wrong import paths** in `index.ts` — `../transaction-builder` should be `../../transaction-builder` (relative to `src/` directory).
  3. **Hardcoded `"testnet"` network** for bot client — now reads `CKB_NETWORK` env var (`createCkbClient(network, RPC_URL)`).
  4. **Wrong `hashType` values** — bot hardcoded `"type"` but devnet contracts use `"data2"`. Added `CONTRACT_HASH_TYPE` env var (default `"data2"`).
  5. **Fee too low on finalization** — `completeFeeBy(signer, 1000)` under-estimates because it doesn't account for the witness data `sendTransaction` adds later. Bumped to 2000 fee rate + added empty witness for campaign-lock input.
  6. **`totalPledged` always 0 for Success/Failed decision** — on-chain `total_pledged` is always 0 (tracked off-chain). Bot now computes from live pledge cells + receipt cells in DB.
  7. **`totalPledged` in finalize tx params** — must match on-chain value (0), not computed value. Contract rejects if `old.total_pledged != new.total_pledged`.
  8. **Race condition: finalize before pledges indexed** — bot finalized campaigns on the same cycle they became expired, before pledge cells were indexed. Added `seenExpired` cooldown set — campaigns must be seen as expired in 2 consecutive cycles before finalization.
  9. **`pledgeCapacity` vs pledge amount mismatch** — bot passed `pledge.amount` (data field, e.g., 250 CKB) but `permissionlessRelease`/`permissionlessRefund` needs actual cell capacity (e.g., 502 CKB including overhead). Bot now fetches cell capacity from chain via `client.getTransaction()`.
  10. **tsconfig changes** — updated `rootDir: "../"`, `include` for cross-package imports, added `ts-node.scopeDir` for transpilation scope.
- **Infrastructure changes:**
  - `off-chain/indexer/tsconfig.json` — `rootDir` changed to `../`, added `../transaction-builder/src/**/*` to include
  - `off-chain/indexer/.env` — added `BOT_PRIVATE_KEY` (devnet Account #2), `CKB_NETWORK`, contract tx hashes, `CONTRACT_HASH_TYPE`
  - `off-chain/indexer/src/index.ts` — fixed import paths, network-aware bot client, configurable hash types
  - `off-chain/indexer/src/bot.ts` — cooldown mechanism, pledge linkage fix, cell capacity fetch, totalPledged computation
  - `off-chain/transaction-builder/src/builder.ts` — finalizeCampaign fee fix (empty witness + 2000 rate)
  - `off-chain/transaction-builder/test-bot.ts` — new bot E2E test script
- **What works on devnet:**
  - [x] Bot auto-detects expired campaigns (with 1-cycle cooldown)
  - [x] Bot correctly computes Success/Failed from pledge+receipt cells
  - [x] Bot auto-finalizes campaign on-chain
  - [x] Bot auto-releases pledge funds to creator (Success path)
  - [x] Bot auto-refunds pledge funds to backer (Failed path — same code pattern, tested via old campaigns)
  - [x] Bot balance monitoring and low-balance warnings
  - [x] Bot gracefully disabled when `BOT_PRIVATE_KEY` not set
- **Phase 17.6 — Testnet Bot Deployment (completed 2026-04-27):**
  - [x] Verify `tsc` build works — fixed `package.json` start path to `dist/indexer/src/index.js` (rootDir nests output)
  - [x] Fixed `CKB_NETWORK` type cast for strict TypeScript compilation
  - [x] Generate dedicated bot wallet for testnet — `ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq0c7jfup93h8wld6za5jm9ksfj9e8u968q8zmd8m`
  - [x] Fund bot wallet — 100,000 CKB via Pudge Faucet
  - [x] Env vars already configured on Render: `BOT_PRIVATE_KEY`, `CKB_NETWORK=testnet`, `CONTRACT_HASH_TYPE=data1`, `CAMPAIGN_LOCK_HASH_TYPE=data`, all code hashes
  - [x] Fixed Render build: updated build command to `npm install && cd ../transaction-builder && npm install && cd ../indexer && npm run build` (tsc compiles cross-package sources that need `@ckb-ccc/core`)
  - [x] Deployed to Render — bot initialized successfully, connected to CKB testnet block 20906079
  - [x] Bot logs confirm: address matches, injected into indexer, polling every 10s
  - [x] **E2E testnet verification (completed 2026-04-27):** all four bot operations confirmed end-to-end
    - Bug found: `CONTRACT_HASH_TYPE=data1` and `CAMPAIGN_LOCK_HASH_TYPE=data` on Render didn't match on-chain cells (which use `data2`). Caused TypeID validation error 12 on every finalize attempt. Fixed by updating both env vars to `data2` and redeploying.
    - Success path: created 200 CKB goal campaign, pledged 250 CKB → bot auto-finalized as Success and auto-released pledge to creator (release tx `0x564c6d7a...`)
    - Failed path: created 10,000 CKB goal campaign, pledged 100 CKB → bot auto-finalized as Failed and auto-refunded pledge to backer (refund tx `0x54fd7e40...`)
    - Zero-pledge edge case: a campaign created with deadline-in-the-past (~33 blocks of sign latency consumed buffer) was auto-finalized by bot as Failed with no pledges to refund — confirming bot tolerates this case
    - Bugs found during E2E (addressed in Phase 17.7): frontend pledge cost estimator overshoot, JoyID UTXO cache staleness UX, bot duplicate-tx error spam
  - [x] Post Nervos Talk update with bot deployment news (posted 2026-04-28)

### Phase 17.7 — Deferred Bug Fixes from E2E Verification ✓ (completed 2026-05-08)

- [x] **BUG: Frontend pledge cost estimator overshoot** — Cost breakdown UI overshot actual wallet deduction by ~30% (e.g. shows 716 CKB but JoyID deducts 550 CKB for 250 CKB pledge). Root cause was a combination of using a 65-byte lock placeholder (real pledge-lock is 105 bytes) and adding the receipt cell to the user-facing total when it's actually owned by the backer. Fix: `pledgeCellCapacity = (8+72+65+105)*1.2 + pledgeAmount`, total = pledgeCellCapacity + fee (no receipt). Verified on-chain (devnet block 24807, tx `0x0e918b49...`): for 200 CKB pledge, displayed 500 CKB matches actual wallet deduction exactly.
- [x] **BUG: JoyID stale-UTXO error UX** — Rapid back-to-back pledges produced raw `TransactionFailedToResolve / Unknown(OutPoint(...))` errors because JoyID's input-cell cache hadn't refreshed. Fix: added `isJoyIDStaleUTXOError()` detector + `sendTransactionWithAutoRetry()` wrapper in `campaigns/[id]/page.tsx`. On detection: 2s delay + retry once. On retry failure: friendly toast "Wallet cells are still syncing — please refresh the page and retry". Code-verified; runtime race didn't naturally trigger during testnet retest (JoyID cache had refreshed by the time the second click landed) — fix remains as a safety net.
- [x] **BUG: Bot duplicate-tx error spam** — Bot resubmitted the same release/refund tx every 10s polling cycle until inclusion, producing `PoolRejectedDuplicatedTransaction` log noise. Fix: `inFlightTxs` Map<pledgeId, txHash> in `FinalizationBot`, populated on submit and cleaned up when pledge cell disappears from indexer DB. Verified on devnet test-bot run: 0 duplicate-tx errors logged, "in-flight, skipping resubmission" messages appear during the in-mempool window as expected.

**Bonus fix:** `/health` → `/status` indexer probe — ad-blocker extensions (uBlock Origin, AdGuard, Privacy Badger) commonly denylist `/health` as a tracking endpoint, causing "Indexer Offline" for users with adblockers even when the backend is fine. Added `/status` endpoint to indexer (mirrors `/health`, kept for ops monitoring) and switched frontend `checkHealth()` to probe `/status`. Confirmed live on production: indexer shows "Online" with adblocker enabled.

**Quick task references:** `.planning/quick/260508-goe-*` (bot duplicate-tx), `.planning/quick/260508-gs6-*` (JoyID UX), `.planning/quick/260508-gwd-*` (estimator overshoot).

### Phase 17.8 — Community UX Feedback Round (yfeng2824)

Scope: four UX issues raised by community member yfeng2824 on `alesfer001/decentralized-kickstarter#1` during the grant proposal feedback window. Fixed during the wait on Scalebit's quote, not deferred to v1.2, so the testnet demo is sharper while reviewers click through.

- [x] **Issue 1 — Deadline field uses blockchain language.** ✅ Shipped 2026-07-07 (`260707-qbf`, commit `388ab3e`). Replaced block-number input with `type="datetime-local"` picker; helper text shows `Current block: #X. Estimated deadline block: #Y.` Verified live on testnet with `Current block: #21,672,933. Estimated deadline block: #21,681,824.`
- [x] **Issue 2 — Homepage campaign list is hard to scan.** ✅ Shipped 2026-07-07 (`260707-q4t`, commit `3e1062a`). Added `All | Active | Funded | Unsuccessful | Expired` filter tabs above the grid; renamed "Failed" → "Unsuccessful" in `getStatusLabel` + `getEffectiveStatusLabel` + detail-page finalization text (enum value preserved for on-chain compat). Verified live: all 5 tabs filter correctly.
- [x] **Issue 3 — Pledge error state feels stale.** ✅ Shipped 2026-07-07 (`260707-pt7`, commit `f527365`). `onChange` handler clears `pledgeError` live when the input becomes a valid non-empty positive number. Verified live: "Insufficient CKB, need 99826 extra CKB" error cleared instantly when amount edited from 99999 → 100.
- [x] **Issue 4 — Pledge wallet breakdown is hard to understand.** ✅ Shipped 2026-07-07 (`260707-pxj`, commit `c547aa1`). Labels reworked to `Campaign pledge / Receipt cell you keep / Network fee / Total locked` (math untouched — reconciled in Phase 17.7). Verified live on testnet pledge form.

**Total estimate:** ~4-6h. **Actual:** ~1.5h across all four quick tasks (executor durations: 12min + 5min + 20min + 12min build/verify). **Why ship now:** reviewers deciding the grant will click through the demo; rough first-impression edges hurt perception. See feedback memory `feedback_keep_shipping_between_funding`.

**Status:** ✅ Phase 17.8 complete. Vercel prod deploy `decentralized-kickstarter-ncdok8xta` aliased to `decentralized-kickstarter-kappa.vercel.app`. All 4 fixes verified via live E2E on testnet (created fresh test campaign `0xb4661dd5827a54d593d74bebdf7d03a2829de883021b0d88764d7cf1858b520b_0`, exercised pledge form). Replied to yfeng2824 on GitHub issue #1 and Telegram.

**2026-05-18:** v1.2 scoping + Nervos Talk community proposal
- Rescoped post-v1.1 work: instead of a single "Phase 18 — Business Model & Treasury", split into v1.2 (fees & treasury), v1.3 (rebrand), v1.4 (user dashboard + UX), v1.5+ (token + governance), v2 (BTC/RGB++). Fiber-subscriptions kept as open/adjacent.
- Locked v1.2 design: 3% creator-side success-only fee, on-chain enforced via pledge-lock treasury-output check, configurable via platform config cell (singleton read via cell_deps), multisig treasury custody until v1.5+, creator-only UI surface on create-campaign form + About/Fees page.
- Drafted and posted strategic-direction + v1.2 proposal to the project's Nervos Talk thread to gather community feedback before implementation. Post asks for input on: audience (launchpad-first → BTC), fee rate, multisig vs DAO custody during the gap, on-chain enforcement design, Fiber subscription demand.
- Pending: community feedback window, then write `.planning/PROJECT.md` / `REQUIREMENTS.md` / new ROADMAP phases (Phase 8+) for v1.2 and start GSD planning.

**2026-05-21:** v1.2 — first community feedback round (RetricSu)
- RetricSu (CKB core dev) replied on the Nervos Talk thread. Confirmed: launchpad-first audience direction, config cell as standard/reasonable, multisig treasury (even solo-developer custody acceptable in early stage), no Fiber subscriptions in early stage.
- **Decision: fee rate raised from 3% → 5% initial** on his recommendation. Easier to dial down later via config cell than to raise; harder to push up once users are anchored on a low rate. Aligns with Kickstarter (5%) for comparability.
- **Fiber subscriptions dropped** from "Open / Adjacent" — moved to "Dropped / Deferred Indefinitely". Revisit only after launchpad use case is proven.
- **Soft gap noted:** RetricSu said "not sure, seems fine" on the on-chain enforcement design rather than validating it. Treasury-output check is the load-bearing security claim of v1.2 — Officeyutong is the natural ask for expert review before mainnet (Phase 14, external review).
- Posted a reply summarizing the decisions taken on board. Thread remains open to gather additional feedback before kicking off implementation.

**2026-05-29:** v1.2 — second feedback round + scope expansion + grant track started
- **Neon (CKB team): "ready to go for a DAO proposal."** Treat as green light; v1.1 track record + locked v1.2 design is enough to start the proposal.
- **Track decision: B (parallel).** Draft the CKB Community Fund DAO grant proposal now in parallel with v1.2 implementation, rather than waiting for v1.2 to ship first. Grant template copied to `docs/grant/community-dao-template-developers.md`.
- **Arthur surfaced a critical architectural gap:** the v1.1 campaign-type script doesn't verify Success vs Failed against actual raised funds — only structural invariants + `since >= deadline_block`. Today an honest finalizer is assumed; a malicious finalizer could flip the terminal status and steal/grief funds. Confirmed against `contracts/campaign/src/main.rs:218-225` which explicitly acknowledges the gap in a comment.
- **Decision: bundle the fix into v1.2** (path A) rather than ship a "v1.1.5 hotfix" first. Cleaner grant narrative ("trustless full lifecycle + sustainable model"), avoids two proposals close together, and pledge-lock fee routing should sit on top of verifiable terminal status from day one.
- **Mechanism: restore on-chain `total_pledged` as a real accumulator** (currently held at 0 per v1.1 design that delegated tracking to the bot). Every pledge tx updates the campaign cell's total; campaign-type script enforces the math. At finalize, script reads `total_pledged` directly and validates Success/Failed against `funding_goal`. Tradeoff: pledge-time contention, mitigated by frontend auto-retry (same pattern as JoyID stale-UTXO fix from Phase 17.7). Alternative considered (reference-all-pledges via cell_deps) rejected — submitter can omit pledges without a counter.
- **Sent concise Telegram reply to Arthur** acknowledging the gap and proposing the v1.2 bundle. Awaiting reply.
- **Scope expansion:** v1.2 phase count grew from 8 to 9 phases. New Phase 8 = campaign accumulator + status verification; original phases shift +1.
- **Scalebit pricing intel from phroi (Telegram):** Scalebit audited iCKB for **$4k USDC for 3 scripts**. v1.2 touches ~5 scripts (campaign-type, pledge-lock, new config cell, plus campaign-lock + receipt for first-time external review) → realistic audit line **$6-8k** (revised down from $8-12k placeholder).
- **Calibrated grant ask: ~$20k total** (peer alignment with CKBoost $20k, Pocket Node $15k, Fiber Link $20k; Fiber Desktop $6k is the small end). Full breakdown in v1.2 budget envelope table above.
- **ETA: ~3.5-4.5 calendar months** at 4.5 h/week with grant drafting and audit elapsed time running in parallel with engineering.
- **Open action items:** email Scalebit for quote, generate CKB grant wallet, draft proposal text against the DAO template.

**2026-06-01:** v1.2 — pre-review of v1.1 contracts (trust-boundary class)
- Ran an internal security review of all 5 v1.1 contracts before drafting the grant proposal, hunting specifically for the class of vulnerability Arthur and Officeyutong surfaced (scripts trusting manipulable external state instead of verifying on-chain).
- Initial gsd-code-reviewer pass flagged 6 issues (2 CRITICAL, 3 WARNING, 1 INFO). After manual cross-script verification, **3 are real medium-severity issues**, 1 is design-as-intended with a fee-policy follow-on, 1 is a false positive (missed cross-script invariant), 1 is a documented tradeoff.
- **Real findings folded into v1.2 scope:**
  - **M-01 (Phase 8):** Campaign destruction doesn't verify pledge cells are consumed in the same tx. Allows DoS against backers (up to 180 days locked out) if a Failed campaign is destroyed before refunds complete. `contracts/campaign/src/main.rs:311-369`.
  - **M-02 (Phase 8):** Receipt destruction doesn't require paired pledge consumption. Allows invariant break (attacker burns own funds to break accounting). `contracts/receipt/src/main.rs:171-212`.
  - **M-03 (Phase 8):** Campaign-lock since validation is less defensive than pledge-lock (no `is_absolute` / `flags_is_valid` check). Defense-in-depth gap; consensus mitigates practical exploit. `contracts/campaign-lock/src/main.rs:62-77`.
  - **D-01 (Phase 9 design item):** Grace-period refund path bypasses fee enforcement (no campaign cell_dep means no fee_bps readable). Not a security issue, but a fee-policy decision needed before Phase 9 contract changes land. Options: accept the bypass, add minimum fee handling, or require config cell as cell_dep on grace-period refunds.
- **Demoted:**
  - **D-02 (false positive):** Pledge merge "backer mismatch" — pledge-lock's lock-hash equality check already enforces the invariant the reviewer expected to find missing.
  - **D-03 (acknowledged tradeoff):** Receipt code_hash vs type_hash cross-check — intentional to avoid circular type-script-hash dependency.
- **Scope impact:** Phase 8 grows from ~8-12h to ~10-15h (folds 3 fixes in). Phase 9 grows ~1-2h for the fee-policy decision. No new phase needed.
- **Grant narrative benefit:** Frame Scalebit engagement as "verify v1.2 trust-boundary tightenings + new fee/treasury code" rather than open-ended audit. Reduces audit scope and cost. Shows due-diligence pattern.
- Full review at `.planning/v12-pre-review/REVIEW.md`.
- **Grant proposal drafted, then rightsized.** Initial draft at $20k (peer-aligned with CKBoost / Pocket Node / Fiber Link). User pushback on overestimation surfaced inflated per-task hours: actual delivery pace from 23 weeks of v1.1 work calibrates to ~30-40h total for v1.2, not ~60-90h. Honest budget shifts to **~$11k** (audit-led, $7k Scalebit + $3k engineering + buffer).
- **Scope expansion: bundle v1.3 + v1.4 + mainnet launch into the grant.** A grant should mean shipping to mainnet; mainnet requires the rebrand (legal); a credible product needs the dashboards. Splitting into multiple proposals isn't reasonable for what's effectively one milestone.
- **Rebrand name picked: CrowdCell.** Plays on "Crowd-Sell" (what a creator does) with "cell" substitution for CKB. Subject to domain + trademark availability check during execution; fallback via community input if unavailable.
- **Final grant ask: $15k** total. Breakdown: $5k engineering (v1.2 + v1.3 + v1.4 + mainnet ops), $7k Scalebit audit, $500 design (logo + brand kit), $500 infra + treasury seed, $300 mainnet bot fund (3 months), $700 launch promo (demo video, Chinese translation, threads), $1k buffer.
- **Milestone structure:** 10% commencement + 5 milestones (M1 on-chain trust + fees, M2 config cell + treasury + integration + testnet E2E, M3 audit, M4 rebrand + dashboards, M5 mainnet launch + promo). ETA ~5-6 months at 4.5 h/week.
- **PROPOSAL.md** finalized at `docs/grant/PROPOSAL.md`. Pending user fill-in: name, background, GitHub handle, project repo link, dedicated CKB grant wallet, Scalebit quote confirmation.

**2026-06-10:** Grant proposal pre-flight — Scalebit outreach + PROPOSAL.md ready for Neon review
- **Scalebit quote request sent.** Short email at `docs/grant/scalebit-email.md` listing the six scripts in scope (campaign type, campaign-lock, pledge type, pledge-lock, receipt, config cell). Awaiting reply with indicative quote and timeline.
- **CKB grant wallet generated:** `ckb1qrgqep8saj8agswr30pls73hra28ry8jlnlc3ejzh3dl2ju7xxpjxqgqqxdl32chss0tlfyexs6h74ny8cc3vl90dgpt6evj`. Filled into PROPOSAL.md §2.
- **PROPOSAL.md placeholders filled:** identity (LESFER Ayoub / @RickSoze), GitHub (alesfer001), project repo (alesfer001/decentralized-kickstarter), background section drafted from CV with Alephium DEX (Ralph) experience framed as transferable to CKB's cell model + ckb-std. Honest scoping of what transferred (UTXO-style thinking, constrained Rust on-chain code) vs what was new (CKB pure cell model).
- **PROPOSAL.md trim pass.** Removed low-signal content for grant judges: infrastructure trivia (Render free tier, adblocker-resistant /status probe), internal phase/finding codes (Phase 8, M-01/M-02/M-03), private intel disclosure (iCKB $4k figure from phroi), self-flattering meta ("pre-audit verification methodology documented and reusable"), redundant reviewer name-dropping. Length cut from ~3,000 to ~2,200 words.
- **§2 Summary restructured.** Original draft led with the trust gap which framed the proposal as "we need to fix a bug." Reordered to lead with user dashboards, fee/treasury model, Scalebit audit, mainnet deployment, public launch (the appealing concrete deliverables), with rebrand and on-chain hardening as items 6-7. Each scope piece now has its own bullet per editorial direction.
- **Sent to Neon for sanity check** via Telegram before posting on Nervos Talk. Waiting for both Neon's feedback and Scalebit's quote before finalizing the audit budget line and posting `[DIS]` version on the CKB Community Fund DAO category.
- **Open actions:** await Neon feedback + Scalebit quote, apply any revisions, then post to Nervos Talk, then Chinese translation follows.

**2026-06-23:** Neon feedback applied + community outreach + Scalebit contact + first community UX feedback
- **Neon's feedback on PROPOSAL.md (received 2026-06-22):** five items, all applied.
  1. Remove Neon mentions — proposal needs to stand on its own merit, and he's not strictly CKB team. Stripped "tested by Neon (CKB team)" and "Neon confirmed the project is ready for a DAO proposal" from §2 Summary and §3 Why now.
  2. Mention whether we have a formal Scalebit quote. Reframed budget line as "placeholder pending formal quote (engagement initiated), invoice will be shared once received" instead of "indicative".
  3. ~$5k purely from developer cost is right per Fiber Desktop precedent; audit cost on top with invoice as evidence (~$7k). Already aligned with our $5k+$7k structure, no change needed.
  4. Link the review journey on GitHub so the community can see the path. Added Officeyutong CKBuilder Projects issue `#6` to §13; also referenced in §3.
  5. Excluding external audit time, keep building to ~4 months. Restructured §8 milestones: M3 (rebrand + dashboards) now runs in parallel with the external audit window, M4 is the audit (calendar driven by Scalebit), M5 is mainnet launch after audit clearance. Build time stays inside ~4 months; total calendar ~5 months including the audit window.
- **PROPOSAL.md is gitignored** (`docs/` in `.gitignore`). Not committed; stays private until posted to Nervos Talk.
- **CKBuilders Telegram group outreach.** Posted concise feedback request mentioning the live testnet demo, GitHub repo, Nervos Talk thread, and Render free-tier cold-start heads-up. Mindset note (saved to `feedback_keep_shipping_between_funding`): not deferring community-surfaced issues to post-grant milestones — shipping cadence is part of credibility being evaluated.
- **Scalebit (BitsLab) replied.** Confirmed they still do audits. Sent terse follow-up: "yes I have a project (CKB Kickstarter v1.2, Rust + ckb-std, 6 contracts), what's your usual process to get a quote?" Awaiting their next ask.
- **First community feedback: yfeng2824 (GitHub issue #1).** Four well-scoped UX notes covering deadline UX (block-number input), homepage scannability (status filter), pledge form error state, and pledge cost breakdown labeling. All four added to Phase 17.8 above. Issue 4 builds on the math-reconciliation work already shipped in Phase 17.7 — that fix corrected the numbers, this one fixes the framing. Replied to yfeng acknowledging the feedback.
- **Tone note saved** (`feedback_natural_message_tone`): drafts for Telegram/Discord/GitHub replies need to read like the user typing, not like an LLM. No em dashes, no arrows, contractions on, skip structured praise.
- **Open actions:** await Scalebit's next message (quote process); ship Phase 17.8 fixes (~4-6h); apply any further Neon revisions if he replies; then post `[DIS]` PROPOSAL.md to Nervos Talk.

**2026-07-07:** Scalebit quote received, Phase 17.8 shipped end-to-end, community loop closed
- **Scalebit quote (received 2026-06-24, opened 2026-07-07):** $5,000 USD for v1.1 scope (5 contracts), quote expires 2026-06-27, preliminary report ~6 days post-payment. **Scope mismatch:** we need v1.2 (6 contracts, 2 modified), not v1.1 (already reviewed by Officeyutong, all findings fixed). Sent short clarification asking for a v1.2-scoped quote. Scalebit's reply: cannot quote v1.2 without seeing the code — reasonable. **Decision: park the v1.2 quote until v1.2 code lands. Use the $5k v1.1 quote as an indicative anchor in PROPOSAL.md §9** (validates the $7k v1.2 placeholder — v1.1's 5 contracts at $5k extrapolates to ~$6-7k for 6 contracts with 2 substantially modified). Updated PROPOSAL.md §8 Commencement row and §9 audit line to reflect quote status.
- **Phase 17.8 shipped in one sitting.** All four yfeng2824 UX fixes: Issue 3 (`f527365`), Issue 4 (`c547aa1`), Issue 2 (`3e1062a`), Issue 1 (`388ab3e`). ~1.5h total across four quick tasks — well under the 4-6h estimate. Details in Phase 17.8 section above.
- **Vercel prod deploy + live verification.** Discovered git auto-deploy hadn't fired (23-day-old cached bundle at `age: 1995909`). Ran `vercel --prod --yes` from `off-chain/frontend/` after user re-auth. Deploy `decentralized-kickstarter-ncdok8xta` aliased to production URL. Walked through all 4 fixes in Chrome: created a fresh testnet campaign (`Phase 17.8 UX Test`, 100 CKB goal, tomorrow 6pm deadline) using the new datetime picker to reach the pledge form for Issues 3+4. All 4 fixes verified visually. Test campaign left running — will auto-expire; ~389 CKB in creator's cell recoverable via v1.1 permissionless finalization.
- **Community loop closed.** Replied to yfeng2824 on GitHub issue #1 and via Telegram DM confirming all 4 shipped with the live URL and cold-start note.
- **Open actions (2026-07-07):** post `[DIS]` PROPOSAL.md to Nervos Talk **[DONE 2026-08-12]**; Chinese translation of proposal; respond to community feedback; start v1.2 GSD phase planning via `/gsd:new-milestone`.

**2026-08-12:** [DIS] CrowdCell grant proposal published to Nervos Talk
- **Proposal is live.** Topic 10609 at https://talk.nervos.org/t/dis-crowdcell-mainnet-launch-of-trustless-all-or-nothing-crowdfunding-on-ckb/10609, posted under DAOs & Funding > CKB Community Fund DAO with the `lang-en` tag. This closes the open action carried since 2026-05-29 (grant track started) and unblocked on 2026-07-07 when the Scalebit quote anchored the audit budget line.
- **Title changed to a colon form:** "[DIS] CrowdCell: Mainnet Launch of Trustless All-or-Nothing Crowdfunding on CKB". All 22 em dashes stripped from the body per house tone preference (see `feedback_natural_message_tone`). Replacements: colon-inside-bold for label lists, sentence breaks where a colon would collide, parentheses for the "Crowd-Sell" aside, semicolon in the §8 time-framing line. The two arrows in §6.1 step 4 were dropped at the same time.
- **Verified on the published post:** both markdown tables (§8 milestones, §9 budget) render as real tables, all §13 links resolve with GitHub rich previews, post runs complete through §13 with no truncation, zero em dashes.
- **Discourse Babel plugin** auto-offers English/简体中文/Español toggles on the post. This does **not** substitute for the manual Chinese translation the DAO process expects; that still needs doing as its own post.
- **Local artifacts synced.** `docs/grant/PROPOSAL.md` (gitignored, stays private) now matches the published text exactly. `.planning/v12-pre-review/REVIEW.md` committed (`710545a`) since the proposal references it publicly in §5 and §13 as "available on request".
- **Post-publication revision 1 (same day), on Neon's feedback.** Two points raised over Telegram: (a) the audit reservation should be visible in the summary, not buried in §9; (b) better to reference an actual quote. Applied his exact suggested form to the §2 bullet: `Grant Amount Requested: $15,000 USD (payable in CKB) - $7,000 USD is specifically reserved for the Scalebit audit`. Attached the Scalebit quotation to §13 with framing that pre-empts the obvious "$5,000 quote vs $7,000 ask" question (v1.1 scope was 5 contracts; v1.2 is 6 with two substantially modified). **Nervos Talk rejects PDF uploads** (allowed: jpg, jpeg, png, gif, svg), so page 2 of `20260624Decentralized Kickstarter.pdf`, the quotation table itself, was rendered to PNG and posted as an image. All 4 pages were reviewed before publishing: cover, quotation table, generic audit-method boilerplate, BitsLab public contact page. No personal data, bank details, or signature.
- **Also confirmed on Neon's request:** he is not named anywhere in the proposal. The two references ("tested by Neon (CKB team)" in §2, "Neon confirmed the project is ready for a DAO proposal" in §3) were already stripped on 2026-06-23 per his own earlier feedback, before the post went live.
- **Open actions:** (1) Chinese translation of the proposal, posted per DAO process; (2) respond to community comments through the DIS window, revising if material feedback lands; (3) after DIS clears, start v1.2 implementation via `/gsd:new-milestone` (PROJECT.md, REQUIREMENTS.md, ROADMAP Phases 8+ — design already locked, planning artifacts never written).

**2026-09-04:** v1.2 Phase 8 — on-chain accumulator, verifiable terminal status, trust-boundary fixes (contract layer)

Implementation started regardless of the DIS outcome, per the "ship between funding rounds" decision. Contracts, transaction builder, indexer, bot and frontend all landed in one session, verified on devnet at the CLI and driven end to end in the browser. Testnet redeploy is the remaining step.

**Campaign accumulator (closes Arthur's finalization trust gap).** `total_pledged` is a real on-chain field again. Every pledge transaction now consumes the campaign cell and re-creates it with `total_pledged += pledge_amount`, and the campaign type script enforces the arithmetic. At finalization the script reads the accumulator directly: `Success` requires `total_pledged >= funding_goal`, `Failed` requires `total_pledged < funding_goal`. A finalizer can no longer assert an outcome the chain does not support.

**How the type script recognises "its" pledges.** Campaign type args grew from 32 to 64 bytes: TypeID (bytes 0-31, unchanged, still validated by `check_type_id`) plus the pledge-lock code hash (bytes 32-63). A pledge cell counts toward this campaign when its lock is the pledge-lock contract *and* the first 32 bytes of its lock args are this campaign's type script hash. That is the binding pledge-lock itself uses to route funds, so the accumulator and the routing agree by construction. The `campaign_id` field in pledge *data* is the creation tx hash and stays informational. Keeping the code hash in args rather than compiling it in lets the two contracts be redeployed independently.

The delta is computed as pledge outputs minus pledge inputs, so a merge nets to zero (and is rejected — merges have no reason to touch the campaign cell), and a net inflow greater than zero is required.

**Campaign-lock had to learn a pre-deadline path.** The lock previously allowed a spend only when `since >= deadline_block`; the accumulator needs the campaign cell spendable *during* the campaign. The lock now allows a spend with no deadline check when the campaign is carried forward intact — an output under the same lock, at least the same capacity, still Active — and applies the deadline gate to everything else (finalization, destruction). What may change in the data stays the type script's business.

**Capacity preservation is now enforced.** Both transition paths require the output campaign cell to hold at least the input's capacity. This closes the second half of the old finalize capacity-leak bug: the builder used to emit a "change" output for the difference, which a permissionless finalizer could have pointed at itself. `finalizeCampaign()` no longer emits it; leftover capacity is reclaimed by the creator at destruction.

**Trust-boundary fixes from `docs/TrustBoundaryReview_v12.md`:**
- **M-01** (campaign destruction pledge leak): Failed campaigns were destructible immediately, locking backers out of refunds for up to the grace period. Both terminal statuses now require `since >= deadline + GRACE_PERIOD_BLOCKS`, so by the time the campaign cell can disappear the pledge-lock grace-period fail-safe is already open for everyone. Chosen over the review's "scan inputs for pledge cells" sketch, which cannot see the pledges a transaction leaves out.
- **M-02** (receipt destruction): `validate_receipt_destruction` now requires a pledge cell in the transaction's inputs, identified by the pledge code hash already carried in receipt args.
- **M-03** (campaign-lock since validation): the lock decodes `since` through `Since::new` / `is_absolute` / `flags_is_valid` / `extract_lock_value` instead of comparing the raw value, matching pledge-lock.

**Known gap, documented not fixed:** `since` is a lower bound, so a lock script cannot express "before the deadline". Pledges therefore remain possible after the deadline until someone finalizes. A creator could self-pledge post-deadline to push their own campaign over its goal — but self-funding was already possible during the campaign, so this is not a new capability. Worth raising with Scalebit.

**Toolchain pinned.** `rust-toolchain.toml` now pins 1.94.0. Rust 1.98 (LLVM 22) fails outright on `-C target-feature=-a` with "Cannot select AtomicLoadAdd" in the `bytes` crate, and a deployed code hash is only meaningful if the build is reproducible. `scripts/build-contracts.sh` also builds campaign-lock, which it had been skipping.

**Finalization bot simplified.** The bot's job narrows to deciding *when* to finalize; the outcome is no longer its call.
- Dropped the one-cycle cooldown in `findExpiredCampaigns` (`seenExpired`). It existed so the indexer could finish indexing pledges before the bot summed them off-chain to pick Success vs Failed. With the accumulator there is nothing to wait for, and the wait only widened the window in which a late pledge can land against an expired campaign. The bot now finalizes on first sight.
- Deleted the off-chain `pledgeTotal`/`receiptTotal` computation in `finalizeSingleCampaign` and stopped passing `newStatus`. The builder reads the live cell and the type script settles the outcome; passing a status now only buys a cross-check that throws on disagreement.
- Indexer API serves the cell's `total_pledged` instead of `calculateTotalPledged()` (which summed live pledge cells and fell back to receipts once they were consumed). `calculateTotalPledged` is marked deprecated and kept one release as a cross-check.

**On the post-deadline pledge window:** the bot is the mitigation, and it is a liveness property, not a safety one — a creator can still race a finalize transaction in the mempool, and no polling interval fixes that. It matters little because self-funding to clear one's own goal was always possible *during* the campaign; the post-deadline window only adds the ability to wait for final numbers before deciding. Worth a line to Scalebit, not a blocker.

**Verified on devnet — 18/18, `off-chain/transaction-builder/test-phase8-accumulator.ts`.** New CLI integration test, run against a live OffCKB devnet with all 5 contracts redeployed. It asserts the contract error codes, not just failure:
- accumulator across two pledges (0 -> 80 -> 230 CKB), campaign out point moving each time, capacity held
- pledge inflating `total_pledged` rejected with **code 16** (`ERROR_INVALID_PLEDGE_UPDATE`)
- finalization claiming Failed while above goal rejected with **code 18** (`ERROR_STATUS_NOT_JUSTIFIED`) — the v1.1 trust gap, closed and demonstrated
- honest finalization from a deliberately stale out point (the creation tx, two pledges dead): Success, total survived, 316 CKB capacity preserved
- v1.1 permissionless release still routes to the creator (+331 CKB)
- M-01 pre-grace campaign destruction rejected with code 13; M-02 receipt destruction without a pledge input rejected with code 23

Also: 10 unit tests in the campaign contract (data round-trip, status-vs-goal justification in both directions, immutable-field and metadata-tail rejection), all 5 contracts build for RISC-V, tx-builder and indexer type-check clean.

**Code review fixes applied.** `finalizeCampaign` now resolves the live campaign cell by type args rather than trusting the caller's out point — the out point moves with every pledge, so the bot's indexer snapshot can be stale, and the pledge path already had recovery while finalization did not. `withTotalPledged` asserts the spliced field is exactly 8 bytes: it is a fixed-offset splice, so a wrong width would shift the metadata tail silently rather than fail, and the type script requires that tail byte-identical. `FinalizeCampaignParams` gained an optional `campaignTypeArgs`.

**Devnet deployment (2026-09-04), superseding the earlier devnet artifacts:** campaign `0x7cf17e2e...529619`, campaign-lock `0xb6e2b333...6401bf`, receipt `0xde0c2b4d...a017d1`. Pledge and pledge-lock code hashes unchanged — neither contract was touched.

**Off-chain integration done and browser-verified (2026-09-04).** Devnet redeployed, indexer + frontend run against it, full flow driven in Chrome.
- **Indexer:** `getOriginalTxHash` now walks the whole chain of campaign-cell updates back to the creation transaction, memoized per campaign type script hash, and runs for every campaign rather than only finalized ones. Before v1.2 there was at most one hop; now the chain is as long as the campaign has backers. Everything downstream (pledge linkage, receipts, backer counts) routes through `getPledgeLinkageTxHash`, so this one fix restores all of it. `getCampaign` also falls back to matching on the creation tx hash, so a link a client is holding still resolves after the cell moves. API exposes `originalTxHash`.
- **Frontend:** campaign creation writes 64-byte type args and sizes capacity for a 97-byte type script; the pledge flow consumes and re-creates the campaign cell (outputs are now `[campaign, pledge, receipt]` — pledge moved from index 0 to 1); finalization resolves the live cell, edits only the status byte, and preserves capacity. Campaign cards and post-pledge refetches use the creation out point as the canonical URL.
- **Browser run:** created a campaign through the UI (64-byte args confirmed on chain), pledged twice as a second account — `total_pledged` went 0 -> 120 -> 320 CKB across two out-point moves with linkage and backer count intact — then seeded a short-deadline funded campaign and watched the bot finalize it to Success on its own and release every pledge to the creator, with the UI following the campaign through all three out-point moves on one stable URL.

**Known UX gaps surfaced by the browser run (not fixed):**
- `datetimeToBlockNumber` enforces a 1-hour (360-block) minimum deadline, so a shorter campaign cannot be created through the UI at all. Deliberate, but it silently overrides what the user picked rather than saying so.
- The same function does `new Date(datetimeString + "Z")`, treating a local datetime-local value as UTC. Pre-existing timezone bug.
- "Destroy Campaign & Reclaim CKB" appears as soon as distribution completes, but the campaign type script requires `deadline + grace period` — the button will fail with error code 13 for ~180 days. Pre-existing for Success campaigns; M-01 extends it to Failed ones too.
- A React hydration mismatch logs on every page load, inside Next.js's own `<Next.Metadata>` internals rather than project components. *(2026-09-17: only happens in the automation Chrome profile, not in a clean browser. Not an app bug, see below.)*

**Not yet done (plus deployment):** testnet redeploy outstanding. *(2026-09-17: pledge-contention retry added to the frontend, see the entry below.)* The frontend continues to duplicate the transaction-builder's logic inline rather than importing it, which is why every contract change has to be made twice. Receipt destruction is currently unexercised by any builder method, so M-02 breaks nothing today, but `seed-frontend-test.ts`'s `consumeCells` cleanup will now fail on receipts unless a pledge is consumed alongside.

**v1.1 test scripts updated but not re-run.** A `createPledgeWithReceipt` transaction now emits `[campaign, pledge, receipt]`, so the pledge cell moved from output 0 to output 1. Thirteen index references across `test-lifecycle.ts`, `test-v1.1-lifecycle.ts` and `test-v1.1-security.ts` were corrected and each file carries a header note explaining the move, but none has been executed since. `seed-frontend-test.ts` and `test-transactions.ts` use the older `createPledge` and are unaffected. `test-phase8-accumulator.ts` is the verified path.

**Landed on branch `v1.2-phase8-accumulator`, not merged.** Twenty-two files across all five contracts and every off-chain package; kept off `main` so the whole of Phase 8 stays reviewable as one diff for Scalebit. Commit `1550a56`.

**Week 26 progress report published** to https://github.com/RickSoze001/ckb-builder-progress-report/blob/main/Week_26.md, matching the terse house format of Weeks 23-25 (headline plus three supporting lines per group, no internal issue IDs, no mechanism detail).

**2026-09-10:** Grant rescoped after the DIS stalled — testnet productisation first, mainnet + audit later

The `[DIS]` (topic 10609) finished at 16 of the 30 likes needed in its week and never reached a vote. Neon's read (Telegram, 2026-09-04):
- Momentum was lost to the long gap between the original discussion thread and the proposal.
- Resubmit, but with material changes: drop the audit request, focus on functionality and features on testnet, keep the total around **$5k**.
- "Productise" the app so the community can see it has direction.
- The forum's language toggle is enough; a manual Chinese translation is no longer necessary. This overrides the 2026-09-01 theory that the missing translation cost the likes.

**Decisions:**
- **Two proposals instead of one bundle.** The $15k "mainnet launch" bundle is retired. A ~$5k testnet productisation proposal goes first; a mainnet + audit proposal follows once there is usage to point at. The later proposal can carry a firm Scalebit invoice instead of the $7k extrapolation, since Scalebit cannot quote v1.2 until its code is final.
- **Fee, config cell and treasury (old Phases 9-11) move to the mainnet proposal.** Fees only matter once real money moves, and the new pledge-lock fee code needs the audit before mainnet in any case. The 5% / config cell / multisig design stays locked; only its timing moves.
- **The CrowdCell rebrand moves into the $5k proposal.** A product identity is part of what "productise" means, and it avoids pitching again under the Kickstarter name.
- **Resubmit after a visible change, not before.** Target ~2-3 weeks: Phase 8 live on testnet and at least one product change shipped, so the post shows momentum rather than promising it. Keep the gap between the project-thread update and the DIS short, and line up likes before the one-week clock starts. Bilingual title still worth doing since it costs nothing.

**New order of work:**
1. ~~Finish Phase 8 on testnet: contract redeploy, frontend pledge-contention retry.~~ Done 2026-09-17, see the entries below.
2. Productisation (rebrand, landing page and UX gaps done 2026-09-23, see below; dashboards still open): CrowdCell rebrand, a proper landing page (**Cellgrid** direction chosen 2026-09-10 from three Fable mockups: CKB cells as the visual system, cell-meter on `CampaignCard`, animated canvas grid behind the hero (kept, not trimmed), settlement diagram, "who can do what" permission matrix. Fixes before building: the matrix must show creators *can* pledge, anyone can finalize when the status verifies, and the grace-period fail-safe is open to anyone after the grace period; drop the stale "65 B header" line; no em dashes or arrows in copy. Mockups in `docs/design/landing/` (local, `docs/` is gitignored). **Poster** direction kept there as the pivot option if the audience shifts to general backers, e.g. after RGB++), creator and backer dashboards, an indexer cold-start experience that says it is waking up instead of "Offline", and the UX gaps from the Phase 8 browser run (deadline timezone bug, silent 1-hour minimum deadline, "Destroy Campaign" button shown ~180 days before it can succeed). Final feature list pending Neon's answer on what felt missing.
3. Rewrite `docs/grant/PROPOSAL.md` for the $5k testnet scope and post the new `[DIS]`.
4. Later proposal: fee enforcement, config cell, multisig treasury, Scalebit audit, mainnet launch.

**2026-09-23 — Where to pick up**

State at end of session:
- CrowdCell rebrand and landing page live on Vercel (PR #6 `1f186de`), together with the deadline and Destroy fixes (PR #5 `f4bbc89`). Landing at `/`, the product at `/app`; campaign detail and create URLs unchanged.
- DIS "ready" checklist (target Mon 2026-10-05): items 1, 2 and 3 done. Open: item 4 (rewrite `docs/grant/PROPOSAL.md` for $5k, line-item budget, milestones, bilingual title) and item 5 (line up ~20-25 likes, project-thread update a few days before, ending with "proposal coming Monday").
- Week 29 progress report published; September has 4 reports (the $300 max).

Next session, in order:
1. Seed 3-4 realistic demo campaigns on testnet, so the app is not just the three "v1.2 testnet E2E" runs when the thread update goes out.
2. Fix "Backers 0" on released campaigns: the indexer counts live pledges only, so a campaign drops to 0 backers once it pays out. Count from receipts or pledge history instead.
3. Proposal rewrite and likes outreach (items 4-5), ~09-28 to 10-02. The thread update can now show the new site.

Loose ends:
- Rebrand beyond the frontend: domain and trademark check on "CrowdCell", then rename the GitHub repo, Render service and Vercel project (the live URL still says decentralized-kickstarter), and update Nervos Talk and CKBuilder Projects.
- `off-chain/frontend/.env.vercel` still points at the old ngrok indexer URL. Not used by deploys, but misleading.
- Still open from 09-17: Officeyutong review of PR #2, rotating the testnet `BOT_PRIVATE_KEY` on Render.
- Lint has 3 errors already on `main` before this work (setState in effects in `DevnetContext.tsx` and `Header.tsx`, an `any` in the campaign page).

**2026-09-23:** UX fixes, CrowdCell rebrand and landing page (DIS checklist items 2 and 3)

- **Deadlines were landing ~6 days early on a 30-day campaign.** The create form parsed the picker's local time as UTC and converted at 10 s/block, while testnet averages 8.0 s (measured over 300k blocks). Now local time and one `SECONDS_PER_BLOCK = 8` constant, which also fixes the "time left" labels. The 1-hour minimum is stated on the form and set as the picker's `min` instead of clamping silently. PR #5.
- **Destroy Campaign** is only offered after deadline + grace period (1,944,000 blocks), with the block and date shown before that. The destroy tx itself could never have succeeded (no `since`, no campaign-lock dep, v1.0 capacity formula); fixed in the frontend and `TransactionBuilder.destroyCampaign`. Not exercised on chain: the grace period is unreachable on testnet and no devnet run was done. PR #5.
- **CrowdCell rebrand and Cellgrid landing page.** Wordmark and icon, Unbounded/Manrope/JetBrains Mono, light/dark tokens (blue = the cell, amber = the funds). After reviewing lido.fi, hyperfoundation.org and aave.com, the landing is marketing only and the product moved to `/app` behind "Launch app": hero with the animated grid and a protocol facts strip, React Flow settlement diagram (including the fail-safe path), permission table checked against the contracts, open-and-verifiable cards, creators band, roadmap, FAQ. PR #6.
- **Copy audit.** The mockup's fail-safe copy was wrong (it credited the receipt; the pledge lock refunds unsettled pledges to their backer after the grace period, triggerable by anyone). Status names unified to Funded / Unsuccessful / Ended, stale "v1.1" text removed, settled campaigns no longer say "No pledges yet".
- **Decided:** no mention of the CKB core developer review on the site; an audit line goes in once the independent audit is done. Live stats, track record, ecosystem logos and a featured-campaigns teaser are deferred until there are numbers worth showing (list in `docs/design/landing/NOTES.md`).

**2026-09-17:** State at end of session
- v1.2 Phase 8 plus the fund-routing fixes are merged to `main` (PR #2 `c64db86`, PR #3 `13c1f01`), deployed on testnet, and live on Vercel and Render. End-to-end verified on testnet with script wallets and a JoyID wallet (entries below).
- DIS "ready" checklist (target Mon 2026-10-05): item 1 (Phase 8 live on testnet + E2E) done. Item 3 partly done (pledge form wording). Open: item 2 (CrowdCell rebrand + Cellgrid landing page), item 3 (deadline timezone bug, silent 1-hour minimum deadline, "Destroy Campaign" button shown ~180 days early), item 4 (rewrite `docs/grant/PROPOSAL.md` for $5k, bilingual title), item 5 (line up ~20-25 likes, project-thread update a few days before).

Next session, in order:
1. Quick UX fixes (checklist item 3).
2. CrowdCell rebrand + Cellgrid landing page (item 2), started by 09-24 at the latest.
3. Proposal rewrite and likes outreach (items 4-5), ~09-28 to 10-02.

Devnet suites after the on-chain lookup fix: exploits 14/14, accounting 36/36, accumulator 18/18, lifecycle 22/22, v1.1 lifecycle 17/17, security 3/3. The three-simultaneous-pledges race then failed (100 of 450 CKB landed): the tx-builder retry slept a fixed 1.5s and, now reading committed cells only, kept rebuilding on the spent cell. It now waits until the live campaign cell moves (as the frontend already did); race passes, 450 CKB.

Loose ends:
- Officeyutong review requested on PR #2 (post-merge); apply feedback as follow-up PRs.
- Rotate the testnet `BOT_PRIVATE_KEY` on Render: it appeared in a screenshot during the env var update. Testnet only, low risk.
- Testnet has finalized "v1.2 testnet E2E" campaigns (success, failure, JoyID) listed on the live site. Harmless, but visible.
- Helper wallet key for testnet E2E in `deployment/testnet-e2e-helper.key` (gitignored), ~780 test CKB left. Deployer ~8.5k CKB left after the redeploy.
- The 7 v1.1 testnet campaign cells and 5 v1.1 receipts are permanently unspendable (their contract cells were reclaimed to fund the v1.2 deploy).
- Contract binaries are unoptimized (~141k CKB to deploy all five). A size profile only saved 9%; type-id upgradeable deployment would avoid paying the full cost again on the next redeploy.

**2026-09-17:** Testnet end-to-end verification (live Vercel + Render indexer + bot)

- **Script wallets:** a success campaign (150 CKB pledged, goal 100) and a failure campaign (100 CKB, goal 1000). The bot finalized both, released and refunded; creator received exactly 150 CKB, backer got back exactly 603.998 CKB (success overhead + whole failed cell, less two 0.001 CKB fees); both receipts reclaimed for the fee only.
- **JoyID wallet through the live frontend:** a 100 CKB pledge deliberately collided with a helper wallet's pledge fired while the JoyID popup was open. The frontend showed the retry toasts, asked for a second approval and the rebuilt pledge landed (`0xde92db1d…6ace7`, campaign total 200 CKB). The bot finalized Success and released it: creator 100 CKB, JoyID wallet 251.999 CKB. The receipt was then reclaimed from the deposit card in the same page session (261.99998486 CKB back, tx `0x6400ba9c…3cd5`).
- **Bug found and fixed (PR #3):** the builder and frontend looked up the live campaign cell through the CCC client cache, which kept returning a campaign cell the wallet had created itself after the bot spent it, so a same-session reclaim used a dead cell dep. Both now use `findCellsOnChain`. The JoyID reclaim above ran on the fixed frontend.

**2026-09-17:** Testnet redeploy — v1.2 Phase 8 + fund-routing fixes

- Reclaimed the five v1.1 contract cells (tx `0x4ad88d73…43c6`, 130,497 CKB) to fund the deploy; deployer went from 22.7k to 153.2k CKB.
- Deployed all five contracts (binaries verified identical to the devnet-tested build by data hash); hashes in `deployment/deployed-contracts-testnet.json`.
- Vercel: 10 `NEXT_PUBLIC_*_CODE_HASH/_TX_HASH` production vars updated and verified via `vercel env pull`; production deployed; PR #2 merged to `main` (review requested from Officeyutong, still open).
- Render indexer: 10 env vars set (5 code hashes updated, 5 `*_TX_HASH` added; without them the indexer fell back to hardcoded v1.1 tx hashes) and redeployed from `main` after PR #2 merged (`c64db86`). Live and synced.

**2026-09-17:** Fund-routing fixes from a balance accounting test (contracts changed, devnet only)

Triggered by a question on whether wallet balances add up across a pledge. `test-accounting.ts` now reads both wallets before and after every step, takes each fee from inputs minus outputs, and asserts the deltas to the shannon. The arithmetic was exact, but it exposed two design problems, and reading the code around them found two exploits. Both exploits were reproduced against the deployed devnet contracts before fixing (`test-v1.2-exploits.ts`).

- **Exploit — fake pledge amount (campaign contract, error 22).** The accumulator counted the `amount` in pledge data without checking the cell held it. A ~253 CKB cell claiming 1000 CKB was accepted and made the campaign fully funded, so anyone (including the creator) could force Success and release every honest pledge. A pledge now counts only when `capacity >= amount + occupied capacity`.
- **Exploit — release double-count (pledge-lock, error 34).** Each pledge-lock group checked "enough goes to the creator" on its own, so two backers' pledges released in one transaction were both satisfied by one creator output and the triggering wallet kept the other 600 CKB. Release and refund now reject transactions spending more than one pledge-lock group.
- **Creator received the backer's cell overhead.** Release sent the whole pledge cell to the creator. It now sends exactly `amount`; the ~252 CKB overhead goes back to the backer (fee comes out of the overhead, 1 CKB cap unchanged). A creator backing their own campaign gets one combined output. The frontend pledge form sized overhead at 300 CKB; now 252, same formula as the tx-builder.
- **Receipts were unreclaimable (Phase 8 M-02 regression).** M-02 required a pledge in the same transaction to destroy a receipt, but permissionless release/refund consume the pledge without it, so every receipt's capacity was stranded. Receipt data grew 40 → 80 bytes (+ campaign type hash + deadline, cross-checked against the pledge lock args at creation, error 24). A receipt can now be destroyed once its campaign cell is finalized (cell dep) or past deadline + grace period; the M-02 path remains for pre-v1.2 receipts and partial refunds. New `TransactionBuilder.reclaimReceipt`.
- **Verified on devnet:** exploits 4/4 rejected (7/7 after the follow-ups below), accounting 36/36 (backer's whole-lifecycle cost for a successful 150 CKB pledge is 150 CKB + 0.002 CKB fees; was 616 CKB), accumulator 18/18, browser pledge accepted with the 80-byte receipt, bot release of a 100 CKB pledge paid creator 100 / backer 251.999.
- **Minimum pledge 100 CKB (campaign contract, error 23).** A release pays the creator exactly `amount` in its own cell, and a cell needs 61+ CKB (more for JoyID-style locks), so a bot release of a 20 CKB pledge failed with `InsufficientCellCapacity`. The accumulator now rejects new pledges under 100 CKB; the tx-builder and the pledge form check it too. Chosen over topping up the creator's cell from the backer's deposit (more complex) and a frontend-only limit (not enforced).
- **Campaign destruction must pay the creator (campaign contract, errors 24/25).** Past the grace period destruction needs no signature, so anyone could destroy a finalized campaign and keep its ~309 CKB. Destruction now requires outputs to the creator's lock of at least capacity − 1 CKB, and no pledge-lock cell may be spent in the same transaction (a pledge release also pays the creator, so one output would satisfy both). The payout check runs before the grace check so it is observable on devnet; the grace period itself is unreachable there, and the no-pledges-in-the-same-tx rule is not exercised by a test.
- **Re-verified after both:** exploits 7/7, accounting 36/36, accumulator 18/18.
- **Frontend follow-up (same day):** "Your receipt deposit" card on finalized campaigns reclaims all of the wallet's receipts in one transaction (browser-verified: two 262 CKB receipts → one 523.99999527 CKB cell). Cost breakdown now shows pledge, pledge deposit (refunded), receipt deposit (refunded), fee, and "Leaves your wallet" as the real total, plus a "Minimum 100 CKB" hint. Manual Release/Refund buttons now work from live pledges instead of `receipts[0]` (they did nothing once a receipt was reclaimed); Refund was also broken before: it only worked for the backer's own wallet and passed no campaign cell dep, so it failed until the grace period. Both browser-verified from a non-backer wallet with the bot off (release: creator 150 / backer 251.999; refund: backer 401.999). Distribution Status no longer says "No pledges" after receipts are reclaimed.
- **Merge exploit (pledge-lock, errors 45/46).** Found while updating the v1.1 test scripts, reproduced on devnet: after a campaign succeeded, a backer merged their pledge cells into one whose pledge type args were `0x`. The pledge type script then saw a destruction group and a creation group instead of a merge, so it never compared amounts, and the merged cell could claim any amount (1 shannon made the pledge unreleasable until the grace-period refund; ~61 CKB released almost nothing to the creator). The pledge-lock merge path now requires every input and the output to share one type script and the output amount to equal the inputs' sum. `mergeContributions` was itself building merged cells with args `0x`; it now keeps the receipt code hash.
- **Old test scripts updated and re-run on devnet:** `test-v1.2-exploits` 14/14, `test-lifecycle` 22/22, `test-v1.1-lifecycle` 17/17, `test-v1.1-security` 3/3, `test-create-campaign` and `seed-frontend-test` complete. Shared setup moved to `test-helpers.ts`; rejection checks now assert the exact script group and error code instead of any error. `test-transactions.ts` stops at its indexer step when no local indexer runs; `test-bot.ts` not run.
- **"First click ignored" was the test browser, not the app.** The hydration error only appears in the automation Chrome profile (the server HTML has `<div hidden>`, the DOM React sees has `display:contents`, which nothing in Next produces). A clean headless Chrome shows no hydration errors on `/`, `/campaigns/new` or a campaign page, and an immediate first click and keystrokes register.
- **Testnet funding:** the five binaries need ~141k CKB and the deployer had 22.7k. No live pledges remained on the v1.1 testnet deployment, so its five contract cells (130,497 CKB) were reclaimed to fund v1.2. The 7 finalized v1.1 campaign cells and 5 v1.1 receipts on testnet become permanently unspendable (~3.2k test CKB).

**2026-09-17:** Pledge-contention retry (frontend) + tx-builder retry fix

- **Race errors measured on devnet, not guessed.** Two pledges on one campaign cell: while the winner is in the pool the loser gets `PoolRejectedRBF` (either "fee too low to replace" or "new Tx contains unconfirmed inputs"); once the winner commits it gets `TransactionFailedToResolve ... Unknown(OutPoint)`. The tx-builder's `isStaleCellError` matched only the committed case, so its retry never fired for a pending race. Fixed; three simultaneous pledges now all land and `total_pledged` is exact.
- **Frontend:** a pledge that loses the race waits (up to 30s) for the campaign cell to move, rebuilds against the new cell and resubmits, 3 attempts total. With a wallet this means a second approval popup, announced by a toast. Replaces the Phase 17.7 JoyID one-shot retry, which resent the identical transaction and so could never succeed once the campaign cell was spent; the stale-wallet-cell case is covered by the rebuild.
- **Browser-verified on devnet:** a single competing pledge → retry succeeds on attempt 2, on-chain total equals the pledge sum. **Known limit:** the wait watches committed cells only, so a campaign receiving a pledge in nearly every block (tested at one per ~8s) exhausts the 3 attempts and shows "try again in a moment". Fine for testnet volume; chaining onto the pool's pending campaign cell would fix it if it ever matters.

**2026-04-20:** Testnet Redeployment — Phase 16 Hardened Contracts
- Deployed all 5 hardened contracts to CKB testnet (Pudge):
  - Campaign: code hash `0x520ff6...a9c897`, tx `0x61f676...331ade`
  - Campaign-Lock: code hash `0x64397e...a52822`, tx `0x45df1c...e7edfd`
  - Pledge: code hash `0xe45d09...8eb024`, tx `0x8bc1ca...63a745`
  - Pledge-Lock: code hash `0xbdcd10...237c48`, tx `0xa7df0d...1b7f36`
  - Receipt: code hash `0xff20a9...694ed6`, tx `0x83cfe3...c4848f`
- Updated Vercel frontend env vars (12 vars: code hashes + tx hashes for all 5 contracts + network + API URL)
- Updated Render indexer env vars (7 vars: 5 code hashes + CKB_NETWORK + CKB_RPC_URL)
- Vercel production redeployed, Render rebuild triggered
- Deployer account: `ckt1qzda0...2kh5k2` (funded via Pudge Faucet)

**2026-09-30:** Demo campaigns seeded on testnet (pick-up item 1)

- New `off-chain/transaction-builder/seed-testnet-demo.ts` (`--dry-run` prints balances and costs). The deployer funds 6 fresh demo wallets (2 creators, 4 backers; keys in the gitignored `deployment/testnet-demo-wallets.json`), then creates 4 campaigns and 7 pledges. Every description starts with "Demo campaign.".
- Live now: CKB Light Client for iOS (650/1,500, 30 days), Spanish translation of the CKB docs (500/800, 21 days), Community faucet for CKB testnet (550/500, Funded), and CKB builders meetup in Lisbon (150/2,000, Unsuccessful). The two short ones were finalized by the Render bot about a minute after their deadline, then released and refunded unattended. That's another live check of the automatic flow.
- Cost about 7.9k test CKB. The deployer is down to about 490 CKB, and roughly 2.2k flows back to demo wallets from the settled campaigns. Top up from the Pudge faucet before any redeploy.
- Also on the list: "CKB Node Runner: a dashboard and service runner for full nodes" (65,000/75,000, 2 backers), created by someone outside the project.
- "Backers 0" cause confirmed: backers are counted from live pledges plus live receipts, and `replaceLiveCells` rebuilds those tables every poll, so the count drops to 0 once payouts happen and receipts are reclaimed. Fix: an append-only campaign_backers table that the rebuild never clears. It isn't hit by the demo campaigns while their receipts stay unreclaimed.
- Context: Neon asked GP (Acceptance team lead) to test CrowdCell today, which is why the list needed to look like a product rather than a test log.
