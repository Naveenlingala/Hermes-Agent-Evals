Upgrade the Agent Evals Platform frontend with a polished design inspired by the visual hierarchy, strong calls to action, feature presentation, and product-focused storytelling of:

https://www.gohighlevel.com/no-code-website-builder?campaign_id=24186900716&gad_campaignid=24186900716&gbraid=0AAAAADCDDbj4n4lZJBv29JX5gwpgr3mHS

IMPORTANT: Treat the reference as design inspiration, not a website to clone. Do not reproduce HighLevel's branding, copy, proprietary assets, or exact page layout. This is an AI agent evaluation PRODUCT, not a website builder or marketing site.

## 1. Design identity

Create a distinctive, premium developer-focused SaaS interface.

* Deep navy navigation/sidebar with a light, neutral workspace.
* A restrained green accent for primary actions and successful results.
* Clear red, amber, and green status indicators that do not rely on color alone.
* Large, crisp headings; readable typography; deliberate whitespace.
* Subtle borders, restrained shadows, consistent corner radii, and carefully aligned content.
* Use the repository's existing design system where possible. Do not add a large UI library just to improve styling.
* Avoid excessive gradients, glowing effects, glassmorphism, random decorative charts, oversized empty cards, and generic AI-generated dashboard styling.

## 2. Product-specific information architecture

Inspect the existing Vue 3 + TypeScript application first. Preserve working functionality and improve its existing pages instead of rebuilding everything unnecessarily.

Create a coherent application shell with navigation for:

* Overview
* Experiments
* Tasks
* Agent Configurations
* Evaluators

Use a clear, prominent "New Experiment" action.

The overview should answer immediately:

* Which agent configuration performs best?
* What is the pass rate?
* How much does each run cost?
* What is the latency?
* Which tasks regress or fail?

The experiment comparison page is the most important screen. It should include:

* A versus B configuration comparison.
* Verified task completion/pass rate.
* Pairwise win, loss, and tie counts if pairwise evaluation is implemented.
* Per-metric score differences.
* Confidence intervals or uncertainty indicators when sufficient trial data exists.
* Latency, token usage, and estimated cost.
* A task-level results table highlighting regressions and improvements.

The run-detail page should show:

* Original task and run configuration.
* Final agent output.
* Tool-call and execution timeline.
* Individual grader scores and explanations.
* Errors, retries, latency, tokens, and cost.
* Clear failure reasons and links to the relevant trace.

## 3. Visualize the data, not just the containers

Use meaningful charts only where they improve evaluation:

* Configuration comparison chart.
* Pass-rate or score distribution.
* Per-task improvement/regression.
* Latency-versus-cost comparison.

Use consistent metric definitions and labels. Never invent statistical confidence, cost, run results, or successful completion. Use clearly marked seeded demonstration data when actual data is unavailable.

Tables should remain useful for technical users. Include sorting or filtering where valuable, empty states, loading states, error states, and detailed tooltips for technical metrics.

## 4. Interaction and responsive behavior

Make experiment creation, task selection, configuration selection, run inspection, and navigation feel like a cohesive application.

Include polished hover, focus, selected, loading, and disabled states. Make important information accessible with keyboard navigation and sufficient contrast. Ensure that tables, charts, navigation, and dialogs work on smaller screens.

Use existing charting and component dependencies if available. Avoid installing additional packages without a clear reason.

## 5. Implementation constraints

* Inspect the existing repository and its instructions before changing code.
* Keep the NestJS API contracts and evaluation semantics intact.
* Reuse existing components and extract shared components only where useful.
* Separate styling tokens from individual page styles.
* Keep the design cohesive across all routes.
* Do not replace real functionality with decorative, non-functional controls.
* Keep all functionality compatible with the one-command local startup requirement.
* Keep code generation token-conscious: implement the design in coherent stages instead of launching multiple agents or rewriting the entire application.
* Do not stop after producing a visual plan. Implement the actual frontend changes.

## 6. Verification and finish

Run the available type checks, tests, and production build. Start the application using its documented command.

If browser or screenshot tooling is already available, inspect the rendered UI at desktop and mobile sizes, identify obvious layout problems, and fix them.

At the end, summarize the pages changed, working interactions, commands executed, verification results, and any remaining limitations.

Begin by inspecting the current implementation, then implement the improved design.