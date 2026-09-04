# ROADMAP.md — Barrister AI

This roadmap is derived entirely from the `barrister_ai_business_strategy.md` file that exists in this repository. That document contains a detailed 30/60/90-day plan written by the project author. Everything listed here is taken directly from that document.

Items are reproduced here as a standalone reference. The source document (`barrister_ai_business_strategy.md`) contains full context, rationale, cost analysis, and prioritisation reasoning.

---

## Days 1–30: "Make It Chargeable"

### Week 1: Foundation
- [ ] Revoke leaked OpenRouter API key, rotate to a new one
- [ ] Change license from MIT to proprietary (AGPL or BSL 1.1)
- [ ] Set up Supabase project (auth + postgres + storage)
- [ ] Implement email/password + Google OAuth signup/login
- [ ] Create `users` table: id, email, plan, docs_used, docs_limit, created_at

### Week 2: Payments
- [ ] Integrate Razorpay Subscriptions (test mode first)
- [ ] Create pricing plans in Razorpay dashboard
- [ ] Build upgrade flow: free limit hit → pricing modal → Razorpay checkout → plan activated
- [ ] Add usage tracking middleware: count docs per user per month
- [ ] Implement plan enforcement: block upload if limit exceeded

### Week 3: Landing & Launch
- [ ] Build landing page: hero + features + pricing table + FAQ + CTA
- [ ] Add SEO meta tags, Open Graph, JSON-LD structured data
- [ ] Set up custom domain
- [ ] Deploy to Railway/Render with Gunicorn
- [ ] Set up Cloudflare for CDN + SSL

### Week 4: Polish & Soft Launch
- [ ] Add email capture on signup → transactional email provider
- [ ] Create onboarding email sequence (3 emails over 7 days)
- [ ] Add analytics
- [ ] Soft launch: share with CA firms / advocates
- [ ] Collect feedback, fix critical bugs

**Target by Day 30:** App live, payments working, 10–20 users signed up, 2–5 paying.

---

## Days 31–60: "Make It Valuable"

### Week 5–6: Value Features
- [ ] PDF report export (branded, professional layout)
- [ ] Document history (user can see past analyses)
- [ ] Indian law context in prompts (Contract Act, IT Act, Companies Act references)
- [ ] "Risk Score" — assign a 1–10 risk score to each document
- [ ] Comparison mode (upload 2 PDFs, see differences)

### Week 7–8: Growth
- [ ] Launch on ProductHunt / BetaList
- [ ] Write 4 SEO blog posts
- [ ] Create free "Rent Agreement Checker" tool page
- [ ] Start LinkedIn posting: 1 post/day about contract analysis insights
- [ ] DM 100 advocates/CAs on LinkedIn with free trial offer

**Target by Day 60:** 50–100 signups, 15–25 paying users, ₹15,000–₹40,000 MRR.

---

## Days 61–90: "Make It Grow"

### Week 9–10: Expansion
- [ ] WhatsApp bot (send PDF via WhatsApp → get analysis back)
- [ ] Team accounts for CA firms (1 admin + 5 team members)
- [ ] API access for Pro/Enterprise users
- [ ] Referral program ("Invite a colleague, both get 5 extra docs")
- [ ] Add 2 more blog posts targeting high-intent keywords

### Week 11–12: Optimisation
- [ ] A/B test pricing page
- [ ] Add testimonials from early users
- [ ] Set up automated dunning (failed payment retry)
- [ ] Upsell emails to free users hitting limits
- [ ] Review analytics: where do users drop off? Fix the top 3 issues.

**Target by Day 90:** 100–200 signups, 40–60 paying users, ₹60,000–₹1,00,000 MRR.

---

## Month 2+ Feature Backlog (from strategy document)

| Feature | Notes |
|---|---|
| Contract comparison / diff view | Upload 2 PDFs, see what changed |
| Team / org accounts | 1 admin + N team members |
| API access | For Pro/Enterprise users |
| WhatsApp bot | Send PDF, get analysis via WhatsApp |
| Hindi / regional language support | Expands addressable market |
| Clause library | "Is this clause standard?" |
| Bulk upload | For due diligence teams |

---

## Immediate Action Items (from strategy document, flagged as "This Weekend")

1. Revoke the exposed OpenRouter API key and generate a new one
2. Change the LICENSE file from MIT to a proprietary license or BSL 1.1
3. Sign up for Supabase (free tier) — create a project for auth + database
4. Sign up for Razorpay — get API keys for test mode
5. Register a domain

---

## Proposed Pricing Tiers (from strategy document)

| Tier | Price | Docs/Month | Questions | Max Pages |
|---|---|---|---|---|
| Free | ₹0 | 3 | 5 | 10 |
| Starter | ₹499/mo | 25 | 50 | 50 |
| Pro | ₹1,999/mo | 100 | Unlimited | 200 |
| Enterprise | ₹4,999/mo | Unlimited | Unlimited | 500 |

---

## Proposed Target Architecture (from strategy document)

The strategy document proposes moving to:

- **Hosting:** Railway or Render (with Gunicorn)
- **CDN/Security:** Cloudflare
- **Auth:** Supabase Auth
- **Database:** Supabase PostgreSQL
- **File Storage:** Cloudflare R2 or Supabase Storage
- **LLM:** Gemini 2.0 Flash (free up to 1500 RPD) with GPT-4o-mini fallback
- **Payments:** Razorpay Subscriptions

None of this architecture exists in the current codebase.
