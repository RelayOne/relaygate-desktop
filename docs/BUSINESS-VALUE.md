# Business Value

RelayGate Desktop is the native window for the RelayGate routing platform — a single, dedicated home for the dashboard your engineering team uses to control, monitor, and pay for every AI request that leaves your company. This document is written for marketers, investors, and prospective customers. It explains the problem we solve, the people who suffer from it today, and why a downloadable desktop app is the right shape for the answer.

## The Problem

Modern engineering teams use AI-assisted development tools constantly. A senior engineer at a typical software company calls into OpenAI, Anthropic, Google, or a self-hosted large language model dozens of times an hour — through their integrated development environment, through their terminal, through scripts that run in continuous integration, through internal chat tools, and through customer-facing features that route user input straight into a model. A team of fifteen engineers can easily generate millions of model calls per month without anyone keeping count.

Each of those vendors charges differently, rate-limits differently, and breaks differently. When ChatGPT goes down at two in the afternoon, every developer who depends on it stops working. When the Anthropic API hits an unexpected rate limit during a deploy, the build fails and the on-call engineer gets paged. When a junior engineer forgets to switch from the most expensive model to a cheaper one for a chatbot prototype, the bill arrives at the end of the month and the chief financial officer has questions nobody can answer cleanly. When a compliance officer asks "did anyone send customer personally identifiable information to a public model last quarter?" — most teams cannot give a confident answer.

Today, the workaround is "manage it manually." Every team has a wiki page about which model to use for which task. Every senior engineer has their own configuration file with their own API keys. Every quarter someone tries to consolidate the spend across providers and fails because the invoices arrive in different formats on different days of the month. Every release cycle someone proposes the same internal proxy project, builds half of it, and abandons it when more urgent work shows up. The cost is real but invisible: hours of engineering time spent on plumbing instead of product, surprise invoices that blow quarterly budgets, outages that cascade because nobody noticed one provider was slow, and audit gaps that quietly accumulate until a regulator or customer asks for evidence the team cannot produce.

## Who This Is For

RelayGate Desktop is built for four kinds of people, and we mention all of them by name on the landing page.

The first is the **engineering manager at a tech company between ten and two hundred people**. They want one bill at the end of the month, one rate-limit policy across their team, and one place to set guardrails so that nobody can accidentally route a high-volume internal feature through a premium model. They do not want to run their own infrastructure unless they have to, and they do not want a quarter-long enterprise rollout.

The second is the **solo developer or small two-to-five person team**. They want to switch between Claude, GPT, Gemini, and a locally running open-source model without rewriting their code each time. They want the option to swap providers when one of them ships a better model next month, without spending a weekend on plumbing. They want to see what they are spending without logging into four separate billing dashboards.

The third is the **platform team at a larger organization**. They are responsible for paving the road that the rest of engineering walks on, and that road increasingly includes AI calls. They need audit trails of which team made which request. They need to see, at a glance, where the spend is concentrated and where the waste is. They need to enforce that production traffic uses production-grade providers and that experiments stay in their experimental sandbox.

The fourth is the **compliance officer in a regulated industry** — financial services, healthcare, legal, defense. They need to enforce that no protected data leaves the company perimeter and goes to a public model provider. They need that enforcement to live at the network layer, not in a checklist that engineers might forget. And they need a defensible audit log they can hand to a regulator without spending a week scraping it together from logs that were never designed for that purpose.

## How RelayGate Desktop Solves It

Instead of juggling five different AI provider tabs, three different application programming interface keys hard-coded in different configuration files, and a chat channel full of people asking "is OpenAI down?" — your team installs RelayGate Desktop. One window on the dock or taskbar. The dashboard inside the window shows live spend, live rate-limit status, and the routing rules currently in force across every provider your team uses.

When the provider you depend on most goes down, traffic transparently routes to your second choice — the dashboard turns yellow, an alert fires on your desktop, and your engineers keep working. When a junior developer tries to call a thirty-cent-per-request model for a feature that should be using a half-cent-per-request model, the policy you set blocks the call before the bill arrives, with a clear error message pointing the developer at the right model. When the compliance officer asks for an audit, the log is one click away, exportable, and complete.

The shift is from "five tabs, three configuration files, and a hope" to "one app, one bill, one policy." That is the entire pitch.

The desktop app specifically — as opposed to using the dashboard in a browser tab — matters for one reason that is obvious only after you have lived with it. When your AI infrastructure is on fire, the alert needs to be visible. A browser tab is the worst possible place to put a status display: it competes with sixty other tabs, it gets closed when you restart the browser, and it disappears entirely when you switch desktops. A native window has its own dock entry, its own command-tab slot, its own taskbar presence. You can see it. You can find it. You can keep it open in a corner of your second monitor for the entire workday and glance at it the way pilots glance at instruments. That is the job RelayGate Desktop is designed to do.

## Key Benefits

We lead with measurable outcomes and the word "you" instead of feature names.

- **One bill across all your AI providers.** Pay one invoice instead of reconciling spend from OpenAI, Anthropic, Google, and your self-hosted models across three different accounting systems and four different invoice formats. Finance teams stop chasing receipts. Engineering managers stop being surprised.

- **Zero-downtime model failover.** When one provider is degraded — slow, rate-limited, or fully down — traffic transparently routes to the next provider in the policy you set. Your team keeps working. Your customers never notice. Your on-call rotation stops getting paged at three in the morning because OpenAI is having a bad night.

- **Spending caps that actually work.** Set a fifty-dollar-per-day limit on a project and have it enforced at the gateway, not by checking the bill at the end of the month and writing an apologetic email. Set a per-team budget. Set a per-model budget. Watch them in real time on the dashboard.

- **One unified programming interface.** Write your code once against an industry-standard programming interface. Switch from one provider to another by changing a routing rule, not by rewriting the part of your application that talks to the model. Future-proof the code your team is shipping today against the model you will want to use next year.

- **Always-visible cost dashboard.** A dedicated window on your dock showing live spend by team, by project, by model, by feature flag — never lose track again. The exact opposite of a billing portal you remember to check once a month.

- **Compliance-grade audit log.** Every request logged with the prompt, the model that handled it, the cost, the team that owned it, and the policy that approved it. Defensible against the question "did anyone send customer data to a public model last quarter?" — defensible enough to hand a regulator without rewriting the answer.

- **Native window, not a browser tab.** The dashboard lives where you watch it, not buried among sixty open tabs. When your AI infrastructure is on fire, the alert is one click away on the dock — and the window is still there tomorrow morning when you sit back down.

- **Cross-platform from day one.** Linux, macOS, and Windows installers ship from the same release. Your team uses what they already use. No "Mac only" or "Windows only" footnote anywhere.

## What Makes This Different

The market for AI infrastructure tooling has two visible shapes today, and RelayGate fits in the gap between them.

On one side are the **thin programming kits** — libraries you import into your application that wrap a single provider's interface or stitch together a few of them. These are useful for the engineer writing the first version of a feature. They do nothing for the manager who needs to see spend across the team, the compliance officer who needs an audit log, or the platform team that needs centralized policy. The engineer still manages all the keys, all the providers, and all the rate limits. The work has been moved, not removed.

On the other side are **heavyweight enterprise platforms** that take a full quarter to roll out, require a procurement process, and lock you into one cloud vendor's ecosystem. These solve the policy and audit problem but at a price that excludes everyone except the largest organizations, and at a speed that excludes anyone who needs to ship something this month.

RelayGate sits in the middle. One small command-line gateway that you can run on your laptop or in your existing infrastructure. One hosted dashboard at our website. One desktop app that is the native interface to either of them. Where some libraries give you the bricks, RelayGate gives you the assembled house. Where the largest cloud vendors lock you into one model family, RelayGate routes across all of them — and across your own self-hosted models too. Where "just write a small proxy yourself" stops working the moment you have more than one engineer, RelayGate has the dashboard, the audit log, the per-team policies, and the desktop app already built and shipping.

## Business Model

RelayGate is open core. The command-line gateway binary is open source, free, and runs on any machine. The hosted dashboard at our website has a generous free tier for individuals and small teams — enough to evaluate the product, enough for a solo developer to use it indefinitely, and enough for a small startup to get real value before paying anything. The exact request volume cutoff for the free tier is `[TBD]` and will be set to land on the side of "generous, not stingy."

The paid tier is priced per seat per month. Pricing is `[TBD]` and will be set in the range that engineering managers can approve without going to procurement. Paid features include longer audit log retention, advanced routing policies, single-sign-on integration, and security assertion markup language federation for organizations that require it.

Enterprise pricing is custom, with on-premises deployment options, dedicated support, and signed contracts. Pricing is `[TBD]` and will be set per customer based on volume, support requirements, and deployment shape.

RelayGate Desktop — the application this document is about — is **free for everyone**. It is the native interface to whatever tier you are already on. We do not charge for the wrapper. We do not gate features behind the desktop app. The desktop app's only job is to make the dashboard pleasant and visible; charging for that would defeat the point.

## Market Opportunity

The market for tools that sit between application code and large language model providers is one of the fastest-growing categories in software infrastructure. The total addressable market is in the tens of billions of dollars and is being formed in front of us as every engineering team in the world either adopts a model gateway, builds one in-house, or pays the operational cost of having neither. The exact figure is `[TBD]` because the category is too new for credible third-party numbers, and we would rather say "tens of billions" honestly than cite a fabricated precise number.

Adoption is being driven by three trends that compound on each other. First, the number of model providers worth talking to has grown from one to roughly half a dozen credible options in two years, and is still growing. Second, the price-per-token of the best models has dropped year over year while the volume of tokens the average application sends has grown faster — so total spend continues to climb even as unit economics improve. Third, every company that ships software is now also a company that ships features powered by large language models, which means the population of customers who need this kind of tool is no longer "AI companies" but "every engineering team."

The desktop app specifically lowers the adoption barrier from "stand up a gateway in your own infrastructure" to "download a one-hundred-megabyte installer and double-click it." That changes who the product is reachable for. It brings RelayGate's value to the solo developer, the two-person startup, and the small consultancy who would never run their own gateway in a data center but absolutely will install a desktop app to see their spend.

## Traction & Proof Points

We are honest about our stage.

The open-source RelayGate gateway is published on a public code repository and is in production use at `[TBD]` companies that have told us about their deployments. Real adoption is presumably higher because nobody is required to tell us they are running an open-source binary.

The hosted dashboard at our website is live, with `[TBD]` teams using it daily as of this writing. The dashboard has been running long enough that we trust the operational metrics; we are not yet ready to publish hard adoption numbers because the trajectory is more interesting than the snapshot.

The desktop app is currently shipping cross-platform installers for Linux, macOS, and Windows as of its first public release, version zero point one. Installers cover the four most common processor architectures across those operating systems and are published to a public download mirror with verifiable cryptographic checksums for every file. The release pipeline is fully automated: every commit to the main branch produces a complete fresh set of installers. Continuous-integration smoke tests verify that the dashboard renders correctly on every build before publication.

This document will be updated as adoption metrics mature. We would rather say `[TBD]` than make up a number that an investor might quote back to us.

## Roadmap

### Shipped

What works today: cross-platform desktop installers for Linux, macOS, and Windows; a dedicated native window for the live RelayGate dashboard; cross-platform native menus that respect each operating system's conventions; a configurable backend uniform resource locator for developers who want to point the app at a local or staging environment; a build identifier embedded in every installer so bug reports can be tied to an exact commit; a hardened security perimeter with a sandboxed renderer and an explicit allowlist of trusted domains; smoke and regression tests that catch breakage before publication; and a fully automated build pipeline that publishes installers to a public download mirror within minutes of every commit.

### Building Now

What is actively in flight: cryptographically signed and notarized macOS installers, so users no longer see the "unidentified developer" warning when they open the application for the first time; signed Windows installers, so users no longer see the "Windows protected your personal computer" warning; and in-application automatic updates so users get bug fixes and security patches without redownloading the installer.

### Coming Next

What is planned for the next several releases: a native control panel for managing a locally-running RelayGate gateway directly from the desktop app — start it, stop it, view its logs, edit its routing rules, all without opening a terminal; a system tray icon for quick access to the most-used controls; operating-system notifications for budget alerts and provider outages, so the alert reaches you even when the window is minimized; and richer cost forecasting and team-level reporting in the dashboard itself.

These are the right next priorities because each one removes one of the remaining reasons a customer might still keep a browser tab open instead of using the desktop app. Once the desktop app is strictly better than the browser version for every use case, the desktop app becomes the obvious default — and that is the goal.

## The Team's Unfair Advantage

Three things, in order of importance.

First, **we lived this problem before we built the product.** The founding team built and operated multi-provider large language model infrastructure at scale before starting RelayGate. We know what breaks because we broke it. We know which features matter because we needed them ourselves. We know which features sound good in a pitch but never actually get used, because we have built those too and watched them collect dust.

Second, **we are open-source first.** The gateway is open. The software development kit is open. The dashboard is hosted free for individuals and small teams. We earn trust by being transparent about how the product works and by giving away the parts of it that should be free. Paid tiers come after trust, not before.

Third, **we ship cross-platform desktop software, well.** Producing nine separate installers across three operating systems and four processor architectures from a single continuous-integration run is harder than it looks, and most teams give up and ship "Mac only" or "Linux only" or "this one operating system, the others coming soon." The fact that RelayGate Desktop ships everywhere on day one, from a single automated pipeline, with cryptographic verification of every file, demonstrates an engineering discipline that translates directly to every other product surface we build. Customers who care about that detail recognize it. Customers who do not care about it still benefit from it, silently, every time they download the app.

---
*Last updated: 2026-05-04*
