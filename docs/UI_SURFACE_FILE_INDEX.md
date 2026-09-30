# ClientTurn UI surface file index

Inspected 2026-09-30. This is a static source inventory, not a runtime QA report. Page entries include redirects, guarded development previews and dynamic route templates. Component entries show source files, not a claim that every file is mounted in production. Backend API handlers are excluded.

## Page routes by section

### Customer app

| Route | Source |
|---|---|
| `/app/agents/[id]` | [page.tsx](../src/app/(app)/app/agents/[id]/page.tsx) |
| `/app/agents/new` | [page.tsx](../src/app/(app)/app/agents/new/page.tsx) |
| `/app/agents` | [page.tsx](../src/app/(app)/app/agents/page.tsx) |
| `/app/analytics` | [page.tsx](../src/app/(app)/app/analytics/page.tsx) |
| `/app/find-leads/campaigns/[campaignId]` | [page.tsx](../src/app/(app)/app/find-leads/campaigns/[campaignId]/page.tsx) |
| `/app/find-leads/campaigns/new` | [page.tsx](../src/app/(app)/app/find-leads/campaigns/new/page.tsx) |
| `/app/find-leads` | [page.tsx](../src/app/(app)/app/find-leads/page.tsx) |
| `/app/find-leads/runs/[runId]` | [page.tsx](../src/app/(app)/app/find-leads/runs/[runId]/page.tsx) |
| `/app/find-leads/scoring/[prospectId]` | [page.tsx](../src/app/(app)/app/find-leads/scoring/[prospectId]/page.tsx) |
| `/app/find-leads/search/[sessionId]` | [page.tsx](../src/app/(app)/app/find-leads/search/[sessionId]/page.tsx) |
| `/app/follow-up` | [page.tsx](../src/app/(app)/app/follow-up/page.tsx) |
| `/app/help/[category]/[slug]` | [page.tsx](../src/app/(app)/app/help/[category]/[slug]/page.tsx) |
| `/app/help/[category]` | [page.tsx](../src/app/(app)/app/help/[category]/page.tsx) |
| `/app/help` | [page.tsx](../src/app/(app)/app/help/page.tsx) |
| `/app/inbox` | [page.tsx](../src/app/(app)/app/inbox/page.tsx) |
| `/app/leads/[id]` | [page.tsx](../src/app/(app)/app/leads/[id]/page.tsx) |
| `/app/leads/import` | [page.tsx](../src/app/(app)/app/leads/import/page.tsx) |
| `/app/leads` | [page.tsx](../src/app/(app)/app/leads/page.tsx) |
| `/app` | [page.tsx](../src/app/(app)/app/page.tsx) |
| `/app/reactivation/new` | [page.tsx](../src/app/(app)/app/reactivation/new/page.tsx) |
| `/app/reactivation` | [page.tsx](../src/app/(app)/app/reactivation/page.tsx) |
| `/app/settings/billing` | [page.tsx](../src/app/(app)/app/settings/billing/page.tsx) |
| `/app/settings/connections` | [page.tsx](../src/app/(app)/app/settings/connections/page.tsx) |
| `/app/settings` | [page.tsx](../src/app/(app)/app/settings/page.tsx) |
| `/app/settings/team` | [page.tsx](../src/app/(app)/app/settings/team/page.tsx) |
| `/app/settings/workspace` | [page.tsx](../src/app/(app)/app/settings/workspace/page.tsx) |
| `/app/support` | [page.tsx](../src/app/(app)/app/support/page.tsx) |

### Admin

| Route | Source |
|---|---|
| `/admin/affiliates` | [page.tsx](../src/app/admin/(ops)/affiliates/page.tsx) |
| `/admin/billing/deletions` | [page.tsx](../src/app/admin/(ops)/billing/deletions/page.tsx) |
| `/admin/billing` | [page.tsx](../src/app/admin/(ops)/billing/page.tsx) |
| `/admin/customers` | [page.tsx](../src/app/admin/(ops)/customers/page.tsx) |
| `/admin/economics` | [page.tsx](../src/app/admin/(ops)/economics/page.tsx) |
| `/admin` | [page.tsx](../src/app/admin/(ops)/page.tsx) |
| `/admin/settings` | [page.tsx](../src/app/admin/(ops)/settings/page.tsx) |
| `/admin/settings/security` | [page.tsx](../src/app/admin/(ops)/settings/security/page.tsx) |
| `/admin/site` | [page.tsx](../src/app/admin/(ops)/site/page.tsx) |
| `/admin/support` | [page.tsx](../src/app/admin/(ops)/support/page.tsx) |
| `/admin/system` | [page.tsx](../src/app/admin/(ops)/system/page.tsx) |

### Affiliate portal

| Route | Source |
|---|---|
| `/affiliates/app/help` | [page.tsx](../src/app/affiliates/app/help/page.tsx) |
| `/affiliates/app/links` | [page.tsx](../src/app/affiliates/app/links/page.tsx) |
| `/affiliates/app` | [page.tsx](../src/app/affiliates/app/page.tsx) |
| `/affiliates/app/payouts` | [page.tsx](../src/app/affiliates/app/payouts/page.tsx) |
| `/affiliates/app/performance` | [page.tsx](../src/app/affiliates/app/performance/page.tsx) |
| `/affiliates/app/referrals` | [page.tsx](../src/app/affiliates/app/referrals/page.tsx) |
| `/affiliates/app/resources` | [page.tsx](../src/app/affiliates/app/resources/page.tsx) |
| `/affiliates/app/settings` | [page.tsx](../src/app/affiliates/app/settings/page.tsx) |

### Onboarding and trial entry

| Route | Source |
|---|---|
| `/affiliates/onboarding` | [page.tsx](../src/app/affiliates/onboarding/page.tsx) |
| `/onboarding` | [page.tsx](../src/app/onboarding/page.tsx) |
| `/start-trial` | [page.tsx](../src/app/start-trial/page.tsx) |

### Authentication

| Route | Source |
|---|---|
| `/forgot-password` | [page.tsx](../src/app/(auth)/forgot-password/page.tsx) |
| `/login` | [page.tsx](../src/app/(auth)/login/page.tsx) |
| `/mfa` | [page.tsx](../src/app/(auth)/mfa/page.tsx) |
| `/reset-password` | [page.tsx](../src/app/(auth)/reset-password/page.tsx) |
| `/signup` | [page.tsx](../src/app/(auth)/signup/page.tsx) |
| `/verify-email` | [page.tsx](../src/app/(auth)/verify-email/page.tsx) |
| `/admin/login` | [page.tsx](../src/app/admin/login/page.tsx) |
| `/admin/mfa` | [page.tsx](../src/app/admin/mfa/page.tsx) |
| `/affiliates/login` | [page.tsx](../src/app/affiliates/login/page.tsx) |
| `/affiliates/signup` | [page.tsx](../src/app/affiliates/signup/page.tsx) |
| `/affiliates/verify-email` | [page.tsx](../src/app/affiliates/verify-email/page.tsx) |

### Public

| Route | Source |
|---|---|
| `/affiliates` | [page.tsx](../src/app/(marketing)/affiliates/page.tsx) |
| `/affiliates/terms` | [page.tsx](../src/app/(marketing)/affiliates/terms/page.tsx) |
| `/compliance` | [page.tsx](../src/app/(marketing)/compliance/page.tsx) |
| `/contact-sales` | [page.tsx](../src/app/(marketing)/contact-sales/page.tsx) |
| `/cookies` | [page.tsx](../src/app/(marketing)/cookies/page.tsx) |
| `/data-deletion` | [page.tsx](../src/app/(marketing)/data-deletion/page.tsx) |
| `/dpa` | [page.tsx](../src/app/(marketing)/dpa/page.tsx) |
| `/enterprise` | [page.tsx](../src/app/(marketing)/enterprise/page.tsx) |
| `/help/[category]/[slug]` | [page.tsx](../src/app/(marketing)/help/[category]/[slug]/page.tsx) |
| `/help/[category]` | [page.tsx](../src/app/(marketing)/help/[category]/page.tsx) |
| `/help` | [page.tsx](../src/app/(marketing)/help/page.tsx) |
| `/how-it-works` | [page.tsx](../src/app/(marketing)/how-it-works/page.tsx) |
| `/` | [page.tsx](../src/app/(marketing)/page.tsx) |
| `/pricing` | [page.tsx](../src/app/(marketing)/pricing/page.tsx) |
| `/privacy` | [page.tsx](../src/app/(marketing)/privacy/page.tsx) |
| `/privacy-request` | [page.tsx](../src/app/(marketing)/privacy-request/page.tsx) |
| `/privacy-request/verify` | [page.tsx](../src/app/(marketing)/privacy-request/verify/page.tsx) |
| `/product/find-leads` | [page.tsx](../src/app/(marketing)/product/find-leads/page.tsx) |
| `/product/lead-conversion` | [page.tsx](../src/app/(marketing)/product/lead-conversion/page.tsx) |
| `/results` | [page.tsx](../src/app/(marketing)/results/page.tsx) |
| `/sdr-cost-calculator` | [page.tsx](../src/app/(marketing)/sdr-cost-calculator/page.tsx) |
| `/sub-processors` | [page.tsx](../src/app/(marketing)/sub-processors/page.tsx) |
| `/terms` | [page.tsx](../src/app/(marketing)/terms/page.tsx) |
| `/q/[token]` | [page.tsx](../src/app/(public)/q/[token]/page.tsx) |
| `/status` | [page.tsx](../src/app/status/page.tsx) |
| `/unsubscribe/[token]` | [page.tsx](../src/app/unsubscribe/[token]/page.tsx) |

### Development previews

| Route | Source |
|---|---|
| `/developers` | [page.tsx](../src/app/(marketing)/developers/page.tsx) |
| `/dev/add-lead` | [page.tsx](../src/app/dev/add-lead/page.tsx) |
| `/dev/admin-preview` | [page.tsx](../src/app/dev/admin-preview/page.tsx) |
| `/dev/quotes-preview` | [page.tsx](../src/app/dev/quotes-preview/page.tsx) |
| `/dev/reactivation-preview` | [page.tsx](../src/app/dev/reactivation-preview/page.tsx) |
| `/dev/site-preview` | [page.tsx](../src/app/dev/site-preview/page.tsx) |
| `/dev/wizard-preview` | [page.tsx](../src/app/dev/wizard-preview/page.tsx) |
| `/dev/wizard-steps` | [page.tsx](../src/app/dev/wizard-steps/page.tsx) |

## All component source files by domain

Includes cards, drawers, dialogs, editors, wizards, tabs, shells and shared primitives. File names are retained so each entry can be checked directly.

### admin

- [admin/admin-profile-menu.tsx](../src/components/admin/admin-profile-menu.tsx)
- [admin/admin-search.tsx](../src/components/admin/admin-search.tsx)
- [admin/admin-shell.tsx](../src/components/admin/admin-shell.tsx)
- [admin/admin-sidebar.tsx](../src/components/admin/admin-sidebar.tsx)
- [admin/admin-top-bar.tsx](../src/components/admin/admin-top-bar.tsx)
- [admin/affiliates/affiliates-view.tsx](../src/components/admin/affiliates/affiliates-view.tsx)
- [admin/affiliates/programme-panels.tsx](../src/components/admin/affiliates/programme-panels.tsx)
- [admin/billing/billing-view.tsx](../src/components/admin/billing/billing-view.tsx)
- [admin/billing/deletion-hold-toggle.tsx](../src/components/admin/billing/deletion-hold-toggle.tsx)
- [admin/billing/subscription-drawer.tsx](../src/components/admin/billing/subscription-drawer.tsx)
- [admin/charts.tsx](../src/components/admin/charts.tsx)
- [admin/customers/customer-filters.tsx](../src/components/admin/customers/customer-filters.tsx)
- [admin/customers/customer-support-drawer.tsx](../src/components/admin/customers/customer-support-drawer.tsx)
- [admin/customers/customer-support-signals.tsx](../src/components/admin/customers/customer-support-signals.tsx)
- [admin/customers/customer-table.tsx](../src/components/admin/customers/customer-table.tsx)
- [admin/customers/customers-view.tsx](../src/components/admin/customers/customers-view.tsx)
- [admin/economics/economics-view.tsx](../src/components/admin/economics/economics-view.tsx)
- [admin/economics/pricing-simulator.tsx](../src/components/admin/economics/pricing-simulator.tsx)
- [admin/economics/workspace-table.tsx](../src/components/admin/economics/workspace-table.tsx)
- [admin/overview/action-required-panel.tsx](../src/components/admin/overview/action-required-panel.tsx)
- [admin/overview/failed-jobs-panel.tsx](../src/components/admin/overview/failed-jobs-panel.tsx)
- [admin/overview/kpi-grid.tsx](../src/components/admin/overview/kpi-grid.tsx)
- [admin/overview/overview-header.tsx](../src/components/admin/overview/overview-header.tsx)
- [admin/overview/provider-health-panel.tsx](../src/components/admin/overview/provider-health-panel.tsx)
- [admin/overview/recent-customers-panel.tsx](../src/components/admin/overview/recent-customers-panel.tsx)
- [admin/settings/provider-drawer.tsx](../src/components/admin/settings/provider-drawer.tsx)
- [admin/settings/settings-view.tsx](../src/components/admin/settings/settings-view.tsx)
- [admin/site/banner-manager.tsx](../src/components/admin/site/banner-manager.tsx)
- [admin/site/maintenance-form.tsx](../src/components/admin/site/maintenance-form.tsx)
- [admin/site/maintenance-state-card.tsx](../src/components/admin/site/maintenance-state-card.tsx)
- [admin/site/maintenance-windows.tsx](../src/components/admin/site/maintenance-windows.tsx)
- [admin/site/site-view.tsx](../src/components/admin/site/site-view.tsx)
- [admin/site/use-site-action.tsx](../src/components/admin/site/use-site-action.tsx)
- [admin/step-up-dialog.tsx](../src/components/admin/step-up-dialog.tsx)
- [admin/support/support-view.tsx](../src/components/admin/support/support-view.tsx)
- [admin/suspend-dialog.tsx](../src/components/admin/suspend-dialog.tsx)
- [admin/system/error-detail-panel.tsx](../src/components/admin/system/error-detail-panel.tsx)
- [admin/system/event-detail-drawer.tsx](../src/components/admin/system/event-detail-drawer.tsx)
- [admin/system/job-detail-drawer.tsx](../src/components/admin/system/job-detail-drawer.tsx)
- [admin/system/merge-candidate-actions.tsx](../src/components/admin/system/merge-candidate-actions.tsx)
- [admin/system/new-policy-version-dialog.tsx](../src/components/admin/system/new-policy-version-dialog.tsx)
- [admin/system/policy-detail-drawer.tsx](../src/components/admin/system/policy-detail-drawer.tsx)
- [admin/system/system-compliance-view.tsx](../src/components/admin/system/system-compliance-view.tsx)
- [admin/system/system-errors-view.tsx](../src/components/admin/system/system-errors-view.tsx)
- [admin/system/system-events-view.tsx](../src/components/admin/system/system-events-view.tsx)
- [admin/system/system-health-view.tsx](../src/components/admin/system/system-health-view.tsx)
- [admin/system/system-jobs-view.tsx](../src/components/admin/system/system-jobs-view.tsx)
- [admin/system/system-readiness-view.tsx](../src/components/admin/system/system-readiness-view.tsx)
- [admin/system/system-revenue-views.tsx](../src/components/admin/system/system-revenue-views.tsx)
- [admin/system/system-view-switch.tsx](../src/components/admin/system/system-view-switch.tsx)
- [admin/system/system-voice-view.tsx](../src/components/admin/system/system-voice-view.tsx)
- [admin/system/voice-ops-controls.tsx](../src/components/admin/system/voice-ops-controls.tsx)
- [admin/ui.tsx](../src/components/admin/ui.tsx)
- [admin/use-admin-action.tsx](../src/components/admin/use-admin-action.tsx)

### affiliates

- [affiliates/application-status-panel.tsx](../src/components/affiliates/application-status-panel.tsx)
- [affiliates/links/links-view.tsx](../src/components/affiliates/links/links-view.tsx)
- [affiliates/links/qr-code.tsx](../src/components/affiliates/links/qr-code.tsx)
- [affiliates/onboarding-wizard.tsx](../src/components/affiliates/onboarding-wizard.tsx)
- [affiliates/payouts/commission-history.tsx](../src/components/affiliates/payouts/commission-history.tsx)
- [affiliates/payouts/payouts-view.tsx](../src/components/affiliates/payouts/payouts-view.tsx)
- [affiliates/portal-ui.tsx](../src/components/affiliates/portal-ui.tsx)
- [affiliates/public/affiliate-hero.tsx](../src/components/affiliates/public/affiliate-hero.tsx)
- [affiliates/public/affiliate-landing.tsx](../src/components/affiliates/public/affiliate-landing.tsx)
- [affiliates/referrals/referrals-view.tsx](../src/components/affiliates/referrals/referrals-view.tsx)
- [affiliates/resources/resources-view.tsx](../src/components/affiliates/resources/resources-view.tsx)
- [affiliates/settings/settings-view.tsx](../src/components/affiliates/settings/settings-view.tsx)
- [affiliates/shell/affiliate-notification-tray.tsx](../src/components/affiliates/shell/affiliate-notification-tray.tsx)
- [affiliates/shell/affiliate-portal-shell.tsx](../src/components/affiliates/shell/affiliate-portal-shell.tsx)
- [affiliates/shell/affiliate-profile-popover.tsx](../src/components/affiliates/shell/affiliate-profile-popover.tsx)
- [affiliates/shell/affiliate-search.tsx](../src/components/affiliates/shell/affiliate-search.tsx)
- [affiliates/shell/affiliate-sidebar.tsx](../src/components/affiliates/shell/affiliate-sidebar.tsx)
- [affiliates/shell/affiliate-top-bar.tsx](../src/components/affiliates/shell/affiliate-top-bar.tsx)
- [affiliates/tier/tier-progress-panel.tsx](../src/components/affiliates/tier/tier-progress-panel.tsx)

### agents

- [agents/agent-call-decision.tsx](../src/components/agents/agent-call-decision.tsx)
- [agents/agent-card.tsx](../src/components/agents/agent-card.tsx)
- [agents/agent-controls.tsx](../src/components/agents/agent-controls.tsx)
- [agents/agent-offer-target-form.tsx](../src/components/agents/agent-offer-target-form.tsx)
- [agents/agent-settings-form.tsx](../src/components/agents/agent-settings-form.tsx)
- [agents/agent-tabs.tsx](../src/components/agents/agent-tabs.tsx)
- [agents/agent-voice-calls-field.tsx](../src/components/agents/agent-voice-calls-field.tsx)
- [agents/agent-wizard.tsx](../src/components/agents/agent-wizard.tsx)
- [agents/agents-view.tsx](../src/components/agents/agents-view.tsx)
- [agents/offer-target-picker.tsx](../src/components/agents/offer-target-picker.tsx)

### analytics

- [analytics/analytics-view.tsx](../src/components/analytics/analytics-view.tsx)
- [analytics/cards.tsx](../src/components/analytics/cards.tsx)
- [analytics/insights-panels.tsx](../src/components/analytics/insights-panels.tsx)
- [analytics/reengagement-panel.tsx](../src/components/analytics/reengagement-panel.tsx)
- [analytics/slices-panel.tsx](../src/components/analytics/slices-panel.tsx)
- [analytics/source-funnels-panel.tsx](../src/components/analytics/source-funnels-panel.tsx)
- [analytics/trend-chart.tsx](../src/components/analytics/trend-chart.tsx)

### app

- [app/account-preferences-dialog.tsx](../src/components/app/account-preferences-dialog.tsx)
- [app/app-shell.tsx](../src/components/app/app-shell.tsx)
- [app/back-link.tsx](../src/components/app/back-link.tsx)
- [app/command-palette.tsx](../src/components/app/command-palette.tsx)
- [app/notification-tray.tsx](../src/components/app/notification-tray.tsx)
- [app/page-header.tsx](../src/components/app/page-header.tsx)
- [app/profile-popover.tsx](../src/components/app/profile-popover.tsx)
- [app/sidebar.tsx](../src/components/app/sidebar.tsx)
- [app/top-bar.tsx](../src/components/app/top-bar.tsx)
- [app/upgrade-card.tsx](../src/components/app/upgrade-card.tsx)

### auth

- [auth/annotation.tsx](../src/components/auth/annotation.tsx)
- [auth/auth-brand-panel.tsx](../src/components/auth/auth-brand-panel.tsx)
- [auth/auth-card.tsx](../src/components/auth/auth-card.tsx)
- [auth/auth-dark-shell.tsx](../src/components/auth/auth-dark-shell.tsx)
- [auth/auth-environment.tsx](../src/components/auth/auth-environment.tsx)
- [auth/auth-shell.tsx](../src/components/auth/auth-shell.tsx)
- [auth/feature-list.tsx](../src/components/auth/feature-list.tsx)
- [auth/google-signin-button.tsx](../src/components/auth/google-signin-button.tsx)
- [auth/grain-overlay.tsx](../src/components/auth/grain-overlay.tsx)
- [auth/mfa-gate-form.tsx](../src/components/auth/mfa-gate-form.tsx)
- [auth/product-preview.tsx](../src/components/auth/product-preview.tsx)
- [auth/tilt-wrapper.tsx](../src/components/auth/tilt-wrapper.tsx)
- [auth/works-with-strip.tsx](../src/components/auth/works-with-strip.tsx)

### automations

- [automations/automation-editor.tsx](../src/components/automations/automation-editor.tsx)
- [automations/automation-rules-board.tsx](../src/components/automations/automation-rules-board.tsx)
- [automations/automation-rules-panel.tsx](../src/components/automations/automation-rules-panel.tsx)
- [automations/stop-conditions.tsx](../src/components/automations/stop-conditions.tsx)

### billing

- [billing/billing-banner.tsx](../src/components/billing/billing-banner.tsx)
- [billing/start-trial-picker.tsx](../src/components/billing/start-trial-picker.tsx)
- [billing/trial-upgrade-modal.tsx](../src/components/billing/trial-upgrade-modal.tsx)
- [billing/trial-upgrade-prompt-mount.tsx](../src/components/billing/trial-upgrade-prompt-mount.tsx)
- [billing/trial-upgrade-prompt.tsx](../src/components/billing/trial-upgrade-prompt.tsx)
- [billing/upgrade-now-button.tsx](../src/components/billing/upgrade-now-button.tsx)
- [billing/upsell-moment-mount.tsx](../src/components/billing/upsell-moment-mount.tsx)
- [billing/upsell-moment.tsx](../src/components/billing/upsell-moment.tsx)

### copilot

- [copilot/confirm-tool-dialog.tsx](../src/components/copilot/confirm-tool-dialog.tsx)
- [copilot/copilot-actions.tsx](../src/components/copilot/copilot-actions.tsx)
- [copilot/copilot-chat.tsx](../src/components/copilot/copilot-chat.tsx)
- [copilot/copilot-drawer.tsx](../src/components/copilot/copilot-drawer.tsx)
- [copilot/copilot-history.tsx](../src/components/copilot/copilot-history.tsx)
- [copilot/copilot-insights.tsx](../src/components/copilot/copilot-insights.tsx)

### dashboard

- [dashboard/booking-outcome-control.tsx](../src/components/dashboard/booking-outcome-control.tsx)
- [dashboard/card-action-link.tsx](../src/components/dashboard/card-action-link.tsx)
- [dashboard/dashboard-header.tsx](../src/components/dashboard/dashboard-header.tsx)
- [dashboard/date-range-picker.tsx](../src/components/dashboard/date-range-picker.tsx)
- [dashboard/follow-up-performance-card.tsx](../src/components/dashboard/follow-up-performance-card.tsx)
- [dashboard/health-strip.tsx](../src/components/dashboard/health-strip.tsx)
- [dashboard/lead-funnel-card.tsx](../src/components/dashboard/lead-funnel-card.tsx)
- [dashboard/needs-attention-panel.tsx](../src/components/dashboard/needs-attention-panel.tsx)
- [dashboard/pending-bookings-card.tsx](../src/components/dashboard/pending-bookings-card.tsx)
- [dashboard/reactivation-performance-card.tsx](../src/components/dashboard/reactivation-performance-card.tsx)
- [dashboard/recent-leads-card.tsx](../src/components/dashboard/recent-leads-card.tsx)
- [dashboard/revenue-control-section.tsx](../src/components/dashboard/revenue-control-section.tsx)
- [dashboard/setup-checklist-card.tsx](../src/components/dashboard/setup-checklist-card.tsx)
- [dashboard/source-icon.tsx](../src/components/dashboard/source-icon.tsx)
- [dashboard/source-performance-card.tsx](../src/components/dashboard/source-performance-card.tsx)
- [dashboard/sparkline.tsx](../src/components/dashboard/sparkline.tsx)
- [dashboard/upcoming-bookings-card.tsx](../src/components/dashboard/upcoming-bookings-card.tsx)

### dev

- [dev/dev-shell.tsx](../src/components/dev/dev-shell.tsx)

### find-leads

- [find-leads/campaigns/campaign-builder.tsx](../src/components/find-leads/campaigns/campaign-builder.tsx)
- [find-leads/campaigns/campaign-controls.tsx](../src/components/find-leads/campaigns/campaign-controls.tsx)
- [find-leads/campaigns/campaigns-view.tsx](../src/components/find-leads/campaigns/campaigns-view.tsx)
- [find-leads/campaigns/detail/campaign-header.tsx](../src/components/find-leads/campaigns/detail/campaign-header.tsx)
- [find-leads/campaigns/detail/controls.tsx](../src/components/find-leads/campaigns/detail/controls.tsx)
- [find-leads/campaigns/detail/overview.tsx](../src/components/find-leads/campaigns/detail/overview.tsx)
- [find-leads/campaigns/detail/performance-chart.tsx](../src/components/find-leads/campaigns/detail/performance-chart.tsx)
- [find-leads/campaigns/detail/tabs.tsx](../src/components/find-leads/campaigns/detail/tabs.tsx)
- [find-leads/campaigns/wizard/audience-step.tsx](../src/components/find-leads/campaigns/wizard/audience-step.tsx)
- [find-leads/campaigns/wizard/budget-step.tsx](../src/components/find-leads/campaigns/wizard/budget-step.tsx)
- [find-leads/campaigns/wizard/campaign-wizard.tsx](../src/components/find-leads/campaigns/wizard/campaign-wizard.tsx)
- [find-leads/campaigns/wizard/company-list-upload.tsx](../src/components/find-leads/campaigns/wizard/company-list-upload.tsx)
- [find-leads/campaigns/wizard/goal-step.tsx](../src/components/find-leads/campaigns/wizard/goal-step.tsx)
- [find-leads/campaigns/wizard/intent-step.tsx](../src/components/find-leads/campaigns/wizard/intent-step.tsx)
- [find-leads/campaigns/wizard/outreach-step.tsx](../src/components/find-leads/campaigns/wizard/outreach-step.tsx)
- [find-leads/campaigns/wizard/pieces.tsx](../src/components/find-leads/campaigns/wizard/pieces.tsx)
- [find-leads/campaigns/wizard/review-step.tsx](../src/components/find-leads/campaigns/wizard/review-step.tsx)
- [find-leads/campaigns/wizard/stepper.tsx](../src/components/find-leads/campaigns/wizard/stepper.tsx)
- [find-leads/campaigns/wizard/token-select.tsx](../src/components/find-leads/campaigns/wizard/token-select.tsx)
- [find-leads/chat-composer.tsx](../src/components/find-leads/chat-composer.tsx)
- [find-leads/discover/acquisition-profile-card.tsx](../src/components/find-leads/discover/acquisition-profile-card.tsx)
- [find-leads/discover/discover-chat.tsx](../src/components/find-leads/discover/discover-chat.tsx)
- [find-leads/discover/discover-view.tsx](../src/components/find-leads/discover/discover-view.tsx)
- [find-leads/discover/recurring-sourcing-card.tsx](../src/components/find-leads/discover/recurring-sourcing-card.tsx)
- [find-leads/discover/search-sessions-rail.tsx](../src/components/find-leads/discover/search-sessions-rail.tsx)
- [find-leads/discover/side-cards.tsx](../src/components/find-leads/discover/side-cards.tsx)
- [find-leads/find-leads-view.tsx](../src/components/find-leads/find-leads-view.tsx)
- [find-leads/intent/category-builder.tsx](../src/components/find-leads/intent/category-builder.tsx)
- [find-leads/intent/intent-controls.tsx](../src/components/find-leads/intent/intent-controls.tsx)
- [find-leads/intent/intent-type-picker.tsx](../src/components/find-leads/intent/intent-type-picker.tsx)
- [find-leads/intent/intent-view.tsx](../src/components/find-leads/intent/intent-view.tsx)
- [find-leads/intent/monitor-builder.tsx](../src/components/find-leads/intent/monitor-builder.tsx)
- [find-leads/kpi-strip.tsx](../src/components/find-leads/kpi-strip.tsx)
- [find-leads/prospect-card.tsx](../src/components/find-leads/prospect-card.tsx)
- [find-leads/prospect-cells.tsx](../src/components/find-leads/prospect-cells.tsx)
- [find-leads/prospect-drawer-host.tsx](../src/components/find-leads/prospect-drawer-host.tsx)
- [find-leads/prospect-drawer.tsx](../src/components/find-leads/prospect-drawer.tsx)
- [find-leads/prospect-filter-panel.tsx](../src/components/find-leads/prospect-filter-panel.tsx)
- [find-leads/prospects/filter-chip.tsx](../src/components/find-leads/prospects/filter-chip.tsx)
- [find-leads/prospects/prospect-bulk-bar.tsx](../src/components/find-leads/prospects/prospect-bulk-bar.tsx)
- [find-leads/prospects/prospect-kpi-strip.tsx](../src/components/find-leads/prospects/prospect-kpi-strip.tsx)
- [find-leads/prospects/prospect-quick-filters.tsx](../src/components/find-leads/prospects/prospect-quick-filters.tsx)
- [find-leads/prospects/prospect-toolbar.tsx](../src/components/find-leads/prospects/prospect-toolbar.tsx)
- [find-leads/prospects-view.tsx](../src/components/find-leads/prospects-view.tsx)
- [find-leads/runs/run-controls.tsx](../src/components/find-leads/runs/run-controls.tsx)
- [find-leads/runs/run-panels.tsx](../src/components/find-leads/runs/run-panels.tsx)
- [find-leads/runs/run-progress-block.tsx](../src/components/find-leads/runs/run-progress-block.tsx)
- [find-leads/runs/sourcing-run-view.tsx](../src/components/find-leads/runs/sourcing-run-view.tsx)
- [find-leads/scoring/explainable-scoring.tsx](../src/components/find-leads/scoring/explainable-scoring.tsx)
- [find-leads/search/linkedin-filters-editor.tsx](../src/components/find-leads/search/linkedin-filters-editor.tsx)
- [find-leads/search/search-conversation.tsx](../src/components/find-leads/search/search-conversation.tsx)
- [find-leads/search/search-session-view.tsx](../src/components/find-leads/search/search-session-view.tsx)
- [find-leads/search/segment-editor.tsx](../src/components/find-leads/search/segment-editor.tsx)
- [find-leads/search/signals-editor.tsx](../src/components/find-leads/search/signals-editor.tsx)
- [find-leads/search/sourcing-controls.tsx](../src/components/find-leads/search/sourcing-controls.tsx)
- [find-leads/search/structured-plan-panel.tsx](../src/components/find-leads/search/structured-plan-panel.tsx)
- [find-leads/social/autopilot-toggle.tsx](../src/components/find-leads/social/autopilot-toggle.tsx)
- [find-leads/social/channel-reality.tsx](../src/components/find-leads/social/channel-reality.tsx)
- [find-leads/social/inmail-panel.tsx](../src/components/find-leads/social/inmail-panel.tsx)
- [find-leads/social/private-reply-window.tsx](../src/components/find-leads/social/private-reply-window.tsx)
- [find-leads/social/sequence-plan.tsx](../src/components/find-leads/social/sequence-plan.tsx)
- [find-leads/social/signals-panel.tsx](../src/components/find-leads/social/signals-panel.tsx)
- [find-leads/social/social-funnel.tsx](../src/components/find-leads/social/social-funnel.tsx)
- [find-leads/social/social-outreach-panel.tsx](../src/components/find-leads/social/social-outreach-panel.tsx)
- [find-leads/social/social-queue-view.tsx](../src/components/find-leads/social/social-queue-view.tsx)
- [find-leads/view-switch.tsx](../src/components/find-leads/view-switch.tsx)

### follow-up

- [follow-up/booking-reminder-card.tsx](../src/components/follow-up/booking-reminder-card.tsx)
- [follow-up/channel-budget-card.tsx](../src/components/follow-up/channel-budget-card.tsx)
- [follow-up/channel-policy-card.tsx](../src/components/follow-up/channel-policy-card.tsx)
- [follow-up/contact-frequency-card.tsx](../src/components/follow-up/contact-frequency-card.tsx)
- [follow-up/enrolment-rules-panel.tsx](../src/components/follow-up/enrolment-rules-panel.tsx)
- [follow-up/follow-up-view.tsx](../src/components/follow-up/follow-up-view.tsx)
- [follow-up/follow-up-workspace.tsx](../src/components/follow-up/follow-up-workspace.tsx)
- [follow-up/linkedin-assist-board.tsx](../src/components/follow-up/linkedin-assist-board.tsx)
- [follow-up/linkedin-assist-view.tsx](../src/components/follow-up/linkedin-assist-view.tsx)
- [follow-up/merge-field-menu.tsx](../src/components/follow-up/merge-field-menu.tsx)
- [follow-up/message-preview-card.tsx](../src/components/follow-up/message-preview-card.tsx)
- [follow-up/performance-panel.tsx](../src/components/follow-up/performance-panel.tsx)
- [follow-up/qualification-view.tsx](../src/components/follow-up/qualification-view.tsx)
- [follow-up/quiet-hours-card.tsx](../src/components/follow-up/quiet-hours-card.tsx)
- [follow-up/sender-identity-card.tsx](../src/components/follow-up/sender-identity-card.tsx)
- [follow-up/sequence-editor.tsx](../src/components/follow-up/sequence-editor.tsx)
- [follow-up/status-card.tsx](../src/components/follow-up/status-card.tsx)
- [follow-up/test-follow-up-panel.tsx](../src/components/follow-up/test-follow-up-panel.tsx)
- [follow-up/usage-and-fields.tsx](../src/components/follow-up/usage-and-fields.tsx)
- [follow-up/view-switch.tsx](../src/components/follow-up/view-switch.tsx)

### help

- [help/contact-support-button.tsx](../src/components/help/contact-support-button.tsx)
- [help/help-centre.tsx](../src/components/help/help-centre.tsx)
- [help/help-icons.tsx](../src/components/help/help-icons.tsx)
- [help/help-markdown.tsx](../src/components/help/help-markdown.tsx)
- [help/help-view-beacon.tsx](../src/components/help/help-view-beacon.tsx)

### inbox

- [inbox/agent-panel.tsx](../src/components/inbox/agent-panel.tsx)
- [inbox/inbox-controls.tsx](../src/components/inbox/inbox-controls.tsx)
- [inbox/inbox-view.tsx](../src/components/inbox/inbox-view.tsx)

### leads

- [leads/add-lead/add-lead-button.tsx](../src/components/leads/add-lead/add-lead-button.tsx)
- [leads/add-lead/add-lead-wizard.tsx](../src/components/leads/add-lead/add-lead-wizard.tsx)
- [leads/add-lead/contact-step.tsx](../src/components/leads/add-lead/contact-step.tsx)
- [leads/add-lead/dev-harness.tsx](../src/components/leads/add-lead/dev-harness.tsx)
- [leads/add-lead/enquiry-step.tsx](../src/components/leads/add-lead/enquiry-step.tsx)
- [leads/add-lead/permission-step.tsx](../src/components/leads/add-lead/permission-step.tsx)
- [leads/add-lead/pieces.tsx](../src/components/leads/add-lead/pieces.tsx)
- [leads/add-lead/route-step.tsx](../src/components/leads/add-lead/route-step.tsx)
- [leads/add-lead/wizard-progress.tsx](../src/components/leads/add-lead/wizard-progress.tsx)
- [leads/close-outcome-dialog.tsx](../src/components/leads/close-outcome-dialog.tsx)
- [leads/conversation-thread.tsx](../src/components/leads/conversation-thread.tsx)
- [leads/detail/add-interest-form.tsx](../src/components/leads/detail/add-interest-form.tsx)
- [leads/detail/best-fit-card.tsx](../src/components/leads/detail/best-fit-card.tsx)
- [leads/detail/checkout-payments-card.tsx](../src/components/leads/detail/checkout-payments-card.tsx)
- [leads/detail/contactability-strip.tsx](../src/components/leads/detail/contactability-strip.tsx)
- [leads/detail/intent-panel.tsx](../src/components/leads/detail/intent-panel.tsx)
- [leads/detail/lead-interests-card.tsx](../src/components/leads/detail/lead-interests-card.tsx)
- [leads/detail/lead-page-actions.tsx](../src/components/leads/detail/lead-page-actions.tsx)
- [leads/detail/lead-page-conversation.tsx](../src/components/leads/detail/lead-page-conversation.tsx)
- [leads/detail/lead-page-data-rights.tsx](../src/components/leads/detail/lead-page-data-rights.tsx)
- [leads/detail/lead-page-header.tsx](../src/components/leads/detail/lead-page-header.tsx)
- [leads/detail/lead-page-tabs.tsx](../src/components/leads/detail/lead-page-tabs.tsx)
- [leads/detail/next-best-action-card.tsx](../src/components/leads/detail/next-best-action-card.tsx)
- [leads/detail/qualification-override-dialogs.tsx](../src/components/leads/detail/qualification-override-dialogs.tsx)
- [leads/detail/revenue-journey-card.tsx](../src/components/leads/detail/revenue-journey-card.tsx)
- [leads/detail/whatsapp-opt-in.tsx](../src/components/leads/detail/whatsapp-opt-in.tsx)
- [leads/import/import-wizard.tsx](../src/components/leads/import/import-wizard.tsx)
- [leads/lead-activity-section.tsx](../src/components/leads/lead-activity-section.tsx)
- [leads/lead-bulk-bar.tsx](../src/components/leads/lead-bulk-bar.tsx)
- [leads/lead-card-grid.tsx](../src/components/leads/lead-card-grid.tsx)
- [leads/lead-card.tsx](../src/components/leads/lead-card.tsx)
- [leads/lead-conversation-section.tsx](../src/components/leads/lead-conversation-section.tsx)
- [leads/lead-data-rights.tsx](../src/components/leads/lead-data-rights.tsx)
- [leads/lead-drawer-host.tsx](../src/components/leads/lead-drawer-host.tsx)
- [leads/lead-drawer.tsx](../src/components/leads/lead-drawer.tsx)
- [leads/lead-filter-popover.tsx](../src/components/leads/lead-filter-popover.tsx)
- [leads/lead-manual-actions.tsx](../src/components/leads/lead-manual-actions.tsx)
- [leads/lead-quick-filters.tsx](../src/components/leads/lead-quick-filters.tsx)
- [leads/lead-row-actions.tsx](../src/components/leads/lead-row-actions.tsx)
- [leads/lead-search-input.tsx](../src/components/leads/lead-search-input.tsx)
- [leads/lead-source-badge.tsx](../src/components/leads/lead-source-badge.tsx)
- [leads/lead-summary-section.tsx](../src/components/leads/lead-summary-section.tsx)
- [leads/leads-content.tsx](../src/components/leads/leads-content.tsx)
- [leads/leads-pagination.tsx](../src/components/leads/leads-pagination.tsx)
- [leads/leads-states.tsx](../src/components/leads/leads-states.tsx)
- [leads/leads-table.tsx](../src/components/leads/leads-table.tsx)
- [leads/leads-toolbar.tsx](../src/components/leads/leads-toolbar.tsx)

### marketing

- [marketing/clientturn-story/Chapters.tsx](../src/components/marketing/clientturn-story/Chapters.tsx)
- [marketing/clientturn-story/ClientTurnStory.tsx](../src/components/marketing/clientturn-story/ClientTurnStory.tsx)
- [marketing/clientturn-story/StoryObjects.tsx](../src/components/marketing/clientturn-story/StoryObjects.tsx)
- [marketing/clientturn-story/StoryScene.tsx](../src/components/marketing/clientturn-story/StoryScene.tsx)
- [marketing/cookie-consent.tsx](../src/components/marketing/cookie-consent.tsx)
- [marketing/cookie-preferences-button.tsx](../src/components/marketing/cookie-preferences-button.tsx)
- [marketing/cta.tsx](../src/components/marketing/cta.tsx)
- [marketing/final-cta.tsx](../src/components/marketing/final-cta.tsx)
- [marketing/find-leads/analytics/acquisition-analytics-section.tsx](../src/components/marketing/find-leads/analytics/acquisition-analytics-section.tsx)
- [marketing/find-leads/analytics/funnel.tsx](../src/components/marketing/find-leads/analytics/funnel.tsx)
- [marketing/find-leads/business-learning/business-learning-section.tsx](../src/components/marketing/find-leads/business-learning/business-learning-section.tsx)
- [marketing/find-leads/campaigns/campaign-panel.tsx](../src/components/marketing/find-leads/campaigns/campaign-panel.tsx)
- [marketing/find-leads/chapter-b.tsx](../src/components/marketing/find-leads/chapter-b.tsx)
- [marketing/find-leads/chapter-c.tsx](../src/components/marketing/find-leads/chapter-c.tsx)
- [marketing/find-leads/final-cta/find-leads-final-cta.tsx](../src/components/marketing/find-leads/final-cta/find-leads-final-cta.tsx)
- [marketing/find-leads/fl-cta.tsx](../src/components/marketing/find-leads/fl-cta.tsx)
- [marketing/find-leads/hero/find-leads-hero-chat.tsx](../src/components/marketing/find-leads/hero/find-leads-hero-chat.tsx)
- [marketing/find-leads/hero/find-leads-hero.tsx](../src/components/marketing/find-leads/hero/find-leads-hero.tsx)
- [marketing/find-leads/hero/previous-chats-drawer.tsx](../src/components/marketing/find-leads/hero/previous-chats-drawer.tsx)
- [marketing/find-leads/intent/intent-panel.tsx](../src/components/marketing/find-leads/intent/intent-panel.tsx)
- [marketing/find-leads/motion-root.tsx](../src/components/marketing/find-leads/motion-root.tsx)
- [marketing/find-leads/motion.tsx](../src/components/marketing/find-leads/motion.tsx)
- [marketing/find-leads/pieces.tsx](../src/components/marketing/find-leads/pieces.tsx)
- [marketing/find-leads/promotion/promotion-panel.tsx](../src/components/marketing/find-leads/promotion/promotion-panel.tsx)
- [marketing/find-leads/prospects/prospects-panel.tsx](../src/components/marketing/find-leads/prospects/prospects-panel.tsx)
- [marketing/find-leads/scoring/scoring-panel.tsx](../src/components/marketing/find-leads/scoring/scoring-panel.tsx)
- [marketing/find-leads/search-plan/search-plan-section.tsx](../src/components/marketing/find-leads/search-plan/search-plan-section.tsx)
- [marketing/find-leads/sourcing/sourcing-agent-chat.tsx](../src/components/marketing/find-leads/sourcing/sourcing-agent-chat.tsx)
- [marketing/hero/ClientTurnHero.tsx](../src/components/marketing/hero/ClientTurnHero.tsx)
- [marketing/hero/HeroCopy.tsx](../src/components/marketing/hero/HeroCopy.tsx)
- [marketing/hero/HeroFallback.tsx](../src/components/marketing/hero/HeroFallback.tsx)
- [marketing/hero/HeroProgress.tsx](../src/components/marketing/hero/HeroProgress.tsx)
- [marketing/hero/HeroStageLabels.tsx](../src/components/marketing/hero/HeroStageLabels.tsx)
- [marketing/hero/scene/BookingNode.tsx](../src/components/marketing/hero/scene/BookingNode.tsx)
- [marketing/hero/scene/CalendarGrid.tsx](../src/components/marketing/hero/scene/CalendarGrid.tsx)
- [marketing/hero/scene/ClientWonNode.tsx](../src/components/marketing/hero/scene/ClientWonNode.tsx)
- [marketing/hero/scene/ConversionRail.tsx](../src/components/marketing/hero/scene/ConversionRail.tsx)
- [marketing/hero/scene/ConversionScene.tsx](../src/components/marketing/hero/scene/ConversionScene.tsx)
- [marketing/hero/scene/Glyph.tsx](../src/components/marketing/hero/scene/Glyph.tsx)
- [marketing/hero/scene/LeadNode.tsx](../src/components/marketing/hero/scene/LeadNode.tsx)
- [marketing/hero/scene/materials.tsx](../src/components/marketing/hero/scene/materials.tsx)
- [marketing/hero/scene/MessageNode.tsx](../src/components/marketing/hero/scene/MessageNode.tsx)
- [marketing/hero/scene/PrecisionBox.tsx](../src/components/marketing/hero/scene/PrecisionBox.tsx)
- [marketing/hero/scene/primitives.tsx](../src/components/marketing/hero/scene/primitives.tsx)
- [marketing/hero/scene/QualificationNode.tsx](../src/components/marketing/hero/scene/QualificationNode.tsx)
- [marketing/hero/scene/SceneCamera.tsx](../src/components/marketing/hero/scene/SceneCamera.tsx)
- [marketing/hero/scene/SceneLights.tsx](../src/components/marketing/hero/scene/SceneLights.tsx)
- [marketing/hero/scene/SceneParticles.tsx](../src/components/marketing/hero/scene/SceneParticles.tsx)
- [marketing/hero.tsx](../src/components/marketing/hero.tsx)
- [marketing/how-it-works.tsx](../src/components/marketing/how-it-works.tsx)
- [marketing/integration-strip.tsx](../src/components/marketing/integration-strip.tsx)
- [marketing/landing-motion.tsx](../src/components/marketing/landing-motion.tsx)
- [marketing/lead-conversion/core-engine/capture-panel.tsx](../src/components/marketing/lead-conversion/core-engine/capture-panel.tsx)
- [marketing/lead-conversion/core-engine/core-engine-section.tsx](../src/components/marketing/lead-conversion/core-engine/core-engine-section.tsx)
- [marketing/lead-conversion/core-engine/follow-up-panel.tsx](../src/components/marketing/lead-conversion/core-engine/follow-up-panel.tsx)
- [marketing/lead-conversion/core-engine/qualification-panel.tsx](../src/components/marketing/lead-conversion/core-engine/qualification-panel.tsx)
- [marketing/lead-conversion/hero/lead-conversion-app-frame.tsx](../src/components/marketing/lead-conversion/hero/lead-conversion-app-frame.tsx)
- [marketing/lead-conversion/hero/lead-conversion-hero.tsx](../src/components/marketing/lead-conversion/hero/lead-conversion-hero.tsx)
- [marketing/lead-conversion/journey/analytics-panel.tsx](../src/components/marketing/lead-conversion/journey/analytics-panel.tsx)
- [marketing/lead-conversion/journey/booking-panel.tsx](../src/components/marketing/lead-conversion/journey/booking-panel.tsx)
- [marketing/lead-conversion/journey/journey-section.tsx](../src/components/marketing/lead-conversion/journey/journey-section.tsx)
- [marketing/lead-conversion/journey/reactivation-panel.tsx](../src/components/marketing/lead-conversion/journey/reactivation-panel.tsx)
- [marketing/lead-conversion/lcp-cta.tsx](../src/components/marketing/lead-conversion/lcp-cta.tsx)
- [marketing/lead-conversion/lead-conversion-final-cta.tsx](../src/components/marketing/lead-conversion/lead-conversion-final-cta.tsx)
- [marketing/lead-conversion/lead-conversion-integrations.tsx](../src/components/marketing/lead-conversion/lead-conversion-integrations.tsx)
- [marketing/lead-conversion/leak/leak-section.tsx](../src/components/marketing/lead-conversion/leak/leak-section.tsx)
- [marketing/lead-conversion/motion.tsx](../src/components/marketing/lead-conversion/motion.tsx)
- [marketing/lead-conversion/primitives.tsx](../src/components/marketing/lead-conversion/primitives.tsx)
- [marketing/legal-page.tsx](../src/components/marketing/legal-page.tsx)
- [marketing/logo.tsx](../src/components/marketing/logo.tsx)
- [marketing/marketing-footer.tsx](../src/components/marketing/marketing-footer.tsx)
- [marketing/marketing-header.tsx](../src/components/marketing/marketing-header.tsx)
- [marketing/pain-timeline.tsx](../src/components/marketing/pain-timeline.tsx)
- [marketing/pricing.tsx](../src/components/marketing/pricing.tsx)
- [marketing/public/actions.tsx](../src/components/marketing/public/actions.tsx)
- [marketing/public/charts.tsx](../src/components/marketing/public/charts.tsx)
- [marketing/public/contact-sales/sales-form.tsx](../src/components/marketing/public/contact-sales/sales-form.tsx)
- [marketing/public/cta-link.tsx](../src/components/marketing/public/cta-link.tsx)
- [marketing/public/developers/code-block.tsx](../src/components/marketing/public/developers/code-block.tsx)
- [marketing/public/faq.tsx](../src/components/marketing/public/faq.tsx)
- [marketing/public/final-cta.tsx](../src/components/marketing/public/final-cta.tsx)
- [marketing/public/home/app-frames.tsx](../src/components/marketing/public/home/app-frames.tsx)
- [marketing/public/home/capabilities.tsx](../src/components/marketing/public/home/capabilities.tsx)
- [marketing/public/home/faq-preview.tsx](../src/components/marketing/public/home/faq-preview.tsx)
- [marketing/public/home/final-cta.tsx](../src/components/marketing/public/home/final-cta.tsx)
- [marketing/public/home/growth-path.tsx](../src/components/marketing/public/home/growth-path.tsx)
- [marketing/public/home/hero-flow-map.tsx](../src/components/marketing/public/home/hero-flow-map.tsx)
- [marketing/public/home/hero.tsx](../src/components/marketing/public/home/hero.tsx)
- [marketing/public/home/how-it-works.tsx](../src/components/marketing/public/home/how-it-works.tsx)
- [marketing/public/home/industries.tsx](../src/components/marketing/public/home/industries.tsx)
- [marketing/public/home/integration-flow.tsx](../src/components/marketing/public/home/integration-flow.tsx)
- [marketing/public/home/integration-grid.tsx](../src/components/marketing/public/home/integration-grid.tsx)
- [marketing/public/home/integrations.tsx](../src/components/marketing/public/home/integrations.tsx)
- [marketing/public/home/partner-frame.tsx](../src/components/marketing/public/home/partner-frame.tsx)
- [marketing/public/home/pricing-preview.tsx](../src/components/marketing/public/home/pricing-preview.tsx)
- [marketing/public/home/product-proof.tsx](../src/components/marketing/public/home/product-proof.tsx)
- [marketing/public/home/scroll-draw.tsx](../src/components/marketing/public/home/scroll-draw.tsx)
- [marketing/public/how-it-works/architecture.tsx](../src/components/marketing/public/how-it-works/architecture.tsx)
- [marketing/public/how-it-works/decision-flow.tsx](../src/components/marketing/public/how-it-works/decision-flow.tsx)
- [marketing/public/pricing/comparison.tsx](../src/components/marketing/public/pricing/comparison.tsx)
- [marketing/public/pricing/plan-grid.tsx](../src/components/marketing/public/pricing/plan-grid.tsx)
- [marketing/public/privacy-request/confirm-request-button.tsx](../src/components/marketing/public/privacy-request/confirm-request-button.tsx)
- [marketing/public/privacy-request/privacy-request-form.tsx](../src/components/marketing/public/privacy-request/privacy-request-form.tsx)
- [marketing/public/public-footer.tsx](../src/components/marketing/public/public-footer.tsx)
- [marketing/public/public-header.tsx](../src/components/marketing/public/public-header.tsx)
- [marketing/public/reveal.tsx](../src/components/marketing/public/reveal.tsx)
- [marketing/public/revenue/in-view.tsx](../src/components/marketing/public/revenue/in-view.tsx)
- [marketing/public/revenue/journey.tsx](../src/components/marketing/public/revenue/journey.tsx)
- [marketing/public/revenue/live-call.tsx](../src/components/marketing/public/revenue/live-call.tsx)
- [marketing/public/revenue/pieces.tsx](../src/components/marketing/public/revenue/pieces.tsx)
- [marketing/public/revenue/sections.tsx](../src/components/marketing/public/revenue/sections.tsx)
- [marketing/public/revenue/voice-pricing.tsx](../src/components/marketing/public/revenue/voice-pricing.tsx)
- [marketing/public/screen.tsx](../src/components/marketing/public/screen.tsx)
- [marketing/public/sdr-calculator/calculator.tsx](../src/components/marketing/public/sdr-calculator/calculator.tsx)
- [marketing/public/shell.tsx](../src/components/marketing/public/shell.tsx)
- [marketing/public/ui.tsx](../src/components/marketing/public/ui.tsx)
- [marketing/reactivation.tsx](../src/components/marketing/reactivation.tsx)
- [marketing/referral-capture.tsx](../src/components/marketing/referral-capture.tsx)
- [marketing/section.tsx](../src/components/marketing/section.tsx)
- [marketing/sections/shell.tsx](../src/components/marketing/sections/shell.tsx)
- [marketing/world/Atmosphere.tsx](../src/components/marketing/world/Atmosphere.tsx)
- [marketing/world/ClientTurnExperience.tsx](../src/components/marketing/world/ClientTurnExperience.tsx)
- [marketing/world/ClientTurnWorld.tsx](../src/components/marketing/world/ClientTurnWorld.tsx)
- [marketing/world/MasterRail.tsx](../src/components/marketing/world/MasterRail.tsx)
- [marketing/world/WorldCamera.tsx](../src/components/marketing/world/WorldCamera.tsx)

### onboarding

- [onboarding/onboarding-environment.tsx](../src/components/onboarding/onboarding-environment.tsx)
- [onboarding/onboarding-shell.tsx](../src/components/onboarding/onboarding-shell.tsx)
- [onboarding/steps/business-step.tsx](../src/components/onboarding/steps/business-step.tsx)
- [onboarding/steps/connect-leads-step.tsx](../src/components/onboarding/steps/connect-leads-step.tsx)
- [onboarding/steps/copilot-step.tsx](../src/components/onboarding/steps/copilot-step.tsx)
- [onboarding/steps/follow-up-step.tsx](../src/components/onboarding/steps/follow-up-step.tsx)
- [onboarding/steps/qualify-book-step.tsx](../src/components/onboarding/steps/qualify-book-step.tsx)
- [onboarding/steps/test-golive-step.tsx](../src/components/onboarding/steps/test-golive-step.tsx)
- [onboarding/ui.tsx](../src/components/onboarding/ui.tsx)
- [onboarding/wizard-progress.tsx](../src/components/onboarding/wizard-progress.tsx)
- [onboarding/wizard.tsx](../src/components/onboarding/wizard.tsx)

### public

- [public/powered-by-badge.tsx](../src/components/public/powered-by-badge.tsx)

### qualification

- [qualification/lead-preview.tsx](../src/components/qualification/lead-preview.tsx)
- [qualification/qualification-editor.tsx](../src/components/qualification/qualification-editor.tsx)
- [qualification/qualification-overview.tsx](../src/components/qualification/qualification-overview.tsx)
- [qualification/question-mapping-dialog.tsx](../src/components/qualification/question-mapping-dialog.tsx)
- [qualification/question-row.tsx](../src/components/qualification/question-row.tsx)
- [qualification/routing-dialog.tsx](../src/components/qualification/routing-dialog.tsx)
- [qualification/service-scope-card.tsx](../src/components/qualification/service-scope-card.tsx)

### quotes

- [quotes/lead-quotes-card.tsx](../src/components/quotes/lead-quotes-card.tsx)
- [quotes/lead-quotes-panel.tsx](../src/components/quotes/lead-quotes-panel.tsx)
- [quotes/public-quote-document.tsx](../src/components/quotes/public-quote-document.tsx)
- [quotes/quote-editor.tsx](../src/components/quotes/quote-editor.tsx)
- [quotes/sign-panel.tsx](../src/components/quotes/sign-panel.tsx)
- [quotes/view-beacon.tsx](../src/components/quotes/view-beacon.tsx)

### reactivation

- [reactivation/campaign-card.tsx](../src/components/reactivation/campaign-card.tsx)
- [reactivation/campaign-edit-dialog.tsx](../src/components/reactivation/campaign-edit-dialog.tsx)
- [reactivation/campaign-experiment-panel.tsx](../src/components/reactivation/campaign-experiment-panel.tsx)
- [reactivation/campaign-icon.tsx](../src/components/reactivation/campaign-icon.tsx)
- [reactivation/campaign-overflow-menu.tsx](../src/components/reactivation/campaign-overflow-menu.tsx)
- [reactivation/campaign-table.tsx](../src/components/reactivation/campaign-table.tsx)
- [reactivation/campaign-toolbar.tsx](../src/components/reactivation/campaign-toolbar.tsx)
- [reactivation/reactivation-content.tsx](../src/components/reactivation/reactivation-content.tsx)
- [reactivation/reactivation-detail-drawer-host.tsx](../src/components/reactivation/reactivation-detail-drawer-host.tsx)
- [reactivation/reactivation-detail-drawer.tsx](../src/components/reactivation/reactivation-detail-drawer.tsx)
- [reactivation/reactivation-summary.tsx](../src/components/reactivation/reactivation-summary.tsx)
- [reactivation/reactivation-view.tsx](../src/components/reactivation/reactivation-view.tsx)
- [reactivation/reactivation-wizard.tsx](../src/components/reactivation/reactivation-wizard.tsx)
- [reactivation/wizard/audience-step.tsx](../src/components/reactivation/wizard/audience-step.tsx)
- [reactivation/wizard/csv-import.tsx](../src/components/reactivation/wizard/csv-import.tsx)
- [reactivation/wizard/dev-harness.tsx](../src/components/reactivation/wizard/dev-harness.tsx)
- [reactivation/wizard/message-timing-step.tsx](../src/components/reactivation/wizard/message-timing-step.tsx)
- [reactivation/wizard/pieces.tsx](../src/components/reactivation/wizard/pieces.tsx)
- [reactivation/wizard/review-launch-step.tsx](../src/components/reactivation/wizard/review-launch-step.tsx)
- [reactivation/wizard/rich-text-editor.tsx](../src/components/reactivation/wizard/rich-text-editor.tsx)
- [reactivation/wizard/wizard-progress.tsx](../src/components/reactivation/wizard/wizard-progress.tsx)

### security

- [security/account-security-panel.tsx](../src/components/security/account-security-panel.tsx)
- [security/workspace-security-form.tsx](../src/components/security/workspace-security-form.tsx)

### settings

- [settings/ai-agent-form.tsx](../src/components/settings/ai-agent-form.tsx)
- [settings/ai-selling/ai-permissions-card.tsx](../src/components/settings/ai-selling/ai-permissions-card.tsx)
- [settings/ai-selling/ai-strategy-card.tsx](../src/components/settings/ai-selling/ai-strategy-card.tsx)
- [settings/ai-selling/brand-card.tsx](../src/components/settings/ai-selling/brand-card.tsx)
- [settings/ai-selling/budget-card.tsx](../src/components/settings/ai-selling/budget-card.tsx)
- [settings/ai-selling/channels-card.tsx](../src/components/settings/ai-selling/channels-card.tsx)
- [settings/ai-selling/competitors-card.tsx](../src/components/settings/ai-selling/competitors-card.tsx)
- [settings/ai-selling/compliance-card.tsx](../src/components/settings/ai-selling/compliance-card.tsx)
- [settings/ai-selling/domain-health-card.tsx](../src/components/settings/ai-selling/domain-health-card.tsx)
- [settings/ai-selling/objections-card.tsx](../src/components/settings/ai-selling/objections-card.tsx)
- [settings/ai-selling/pipeline-stages-card.tsx](../src/components/settings/ai-selling/pipeline-stages-card.tsx)
- [settings/ai-selling/qualification-policy-card.tsx](../src/components/settings/ai-selling/qualification-policy-card.tsx)
- [settings/ai-selling/sales-behaviour-card.tsx](../src/components/settings/ai-selling/sales-behaviour-card.tsx)
- [settings/ai-selling/scoring-weights-card.tsx](../src/components/settings/ai-selling/scoring-weights-card.tsx)
- [settings/ai-selling/section-load-error.tsx](../src/components/settings/ai-selling/section-load-error.tsx)
- [settings/ai-token-meter.tsx](../src/components/settings/ai-token-meter.tsx)
- [settings/billing/billing-settings.tsx](../src/components/settings/billing/billing-settings.tsx)
- [settings/billing/limits-panel.tsx](../src/components/settings/billing/limits-panel.tsx)
- [settings/billing/upsell-billing-card.tsx](../src/components/settings/billing/upsell-billing-card.tsx)
- [settings/billing/usage-panel.tsx](../src/components/settings/billing/usage-panel.tsx)
- [settings/booking-form.tsx](../src/components/settings/booking-form.tsx)
- [settings/business-profile/business-profile-section.tsx](../src/components/settings/business-profile/business-profile-section.tsx)
- [settings/business-profile/direct-close-editor.tsx](../src/components/settings/business-profile/direct-close-editor.tsx)
- [settings/business-profile/goal-editor.tsx](../src/components/settings/business-profile/goal-editor.tsx)
- [settings/business-profile/icp-editor.tsx](../src/components/settings/business-profile/icp-editor.tsx)
- [settings/business-profile/outreach-guidance.tsx](../src/components/settings/business-profile/outreach-guidance.tsx)
- [settings/compliance/audit-log-export.tsx](../src/components/settings/compliance/audit-log-export.tsx)
- [settings/compliance/data-controls-form.tsx](../src/components/settings/compliance/data-controls-form.tsx)
- [settings/compliance/privacy-requests-panel.tsx](../src/components/settings/compliance/privacy-requests-panel.tsx)
- [settings/compliance/retention-preview.tsx](../src/components/settings/compliance/retention-preview.tsx)
- [settings/connections/app-marketplace.tsx](../src/components/settings/connections/app-marketplace.tsx)
- [settings/connections/channel-controls.tsx](../src/components/settings/connections/channel-controls.tsx)
- [settings/connections/connect-result-toast.tsx](../src/components/settings/connections/connect-result-toast.tsx)
- [settings/connections/connection-card.tsx](../src/components/settings/connections/connection-card.tsx)
- [settings/connections/connection-group.tsx](../src/components/settings/connections/connection-group.tsx)
- [settings/connections/connection-health-summary.tsx](../src/components/settings/connections/connection-health-summary.tsx)
- [settings/connections/connection-setup-drawer.tsx](../src/components/settings/connections/connection-setup-drawer.tsx)
- [settings/connections/connections-settings.tsx](../src/components/settings/connections/connections-settings.tsx)
- [settings/connections/connector-operations.tsx](../src/components/settings/connections/connector-operations.tsx)
- [settings/connections/crm-pull-panel.tsx](../src/components/settings/connections/crm-pull-panel.tsx)
- [settings/connections/discovery-status.tsx](../src/components/settings/connections/discovery-status.tsx)
- [settings/connections/email-mailbox-panel.tsx](../src/components/settings/connections/email-mailbox-panel.tsx)
- [settings/connections/mcp-connections-panel.tsx](../src/components/settings/connections/mcp-connections-panel.tsx)
- [settings/connections/payments-cards.tsx](../src/components/settings/connections/payments-cards.tsx)
- [settings/connections/payments-section.tsx](../src/components/settings/connections/payments-section.tsx)
- [settings/connections/provider-details.tsx](../src/components/settings/connections/provider-details.tsx)
- [settings/connections/provider-icon.tsx](../src/components/settings/connections/provider-icon.tsx)
- [settings/connections/social-accounts-card.tsx](../src/components/settings/connections/social-accounts-card.tsx)
- [settings/connections/whatsapp-templates-panel.tsx](../src/components/settings/connections/whatsapp-templates-panel.tsx)
- [settings/danger-zone.tsx](../src/components/settings/danger-zone.tsx)
- [settings/developer/api-keys-panel.tsx](../src/components/settings/developer/api-keys-panel.tsx)
- [settings/developer/developer-overview.tsx](../src/components/settings/developer/developer-overview.tsx)
- [settings/developer/webhooks-panel.tsx](../src/components/settings/developer/webhooks-panel.tsx)
- [settings/meeting-types/meeting-types-panel.tsx](../src/components/settings/meeting-types/meeting-types-panel.tsx)
- [settings/meeting-types/meeting-types-section.tsx](../src/components/settings/meeting-types/meeting-types-section.tsx)
- [settings/messaging-form.tsx](../src/components/settings/messaging-form.tsx)
- [settings/notices.tsx](../src/components/settings/notices.tsx)
- [settings/quotes/catalogue-card.tsx](../src/components/settings/quotes/catalogue-card.tsx)
- [settings/quotes/payment-review-card.tsx](../src/components/settings/quotes/payment-review-card.tsx)
- [settings/quotes/quote-settings-form.tsx](../src/components/settings/quotes/quote-settings-form.tsx)
- [settings/settings-save-bar.tsx](../src/components/settings/settings-save-bar.tsx)
- [settings/settings-section-nav.tsx](../src/components/settings/settings-section-nav.tsx)
- [settings/settings-skeleton.tsx](../src/components/settings/settings-skeleton.tsx)
- [settings/team/invite-member-dialog.tsx](../src/components/settings/team/invite-member-dialog.tsx)
- [settings/team/member-permissions.tsx](../src/components/settings/team/member-permissions.tsx)
- [settings/team/team-settings.tsx](../src/components/settings/team/team-settings.tsx)
- [settings/voice/voice-budget-panel.tsx](../src/components/settings/voice/voice-budget-panel.tsx)
- [settings/voice/voice-config-panels.tsx](../src/components/settings/voice/voice-config-panels.tsx)
- [settings/voice/voice-identity-panel.tsx](../src/components/settings/voice/voice-identity-panel.tsx)
- [settings/voice/voice-number-panel.tsx](../src/components/settings/voice/voice-number-panel.tsx)
- [settings/voice/voice-settings-panels.tsx](../src/components/settings/voice/voice-settings-panels.tsx)
- [settings/voice/voice-shared.tsx](../src/components/settings/voice/voice-shared.tsx)
- [settings/workspace/business-hours-editor.tsx](../src/components/settings/workspace/business-hours-editor.tsx)
- [settings/workspace/business-identity-card.tsx](../src/components/settings/workspace/business-identity-card.tsx)
- [settings/workspace/logo-uploader.tsx](../src/components/settings/workspace/logo-uploader.tsx)
- [settings/workspace/service-area-field.tsx](../src/components/settings/workspace/service-area-field.tsx)
- [settings/workspace/service-editor-drawer.tsx](../src/components/settings/workspace/service-editor-drawer.tsx)
- [settings/workspace/services-table.tsx](../src/components/settings/workspace/services-table.tsx)
- [settings/workspace/workspace-preview.tsx](../src/components/settings/workspace/workspace-preview.tsx)
- [settings/workspace/workspace-settings.tsx](../src/components/settings/workspace/workspace-settings.tsx)

### site

- [site/app-notices.tsx](../src/components/site/app-notices.tsx)
- [site/bypass-pill.tsx](../src/components/site/bypass-pill.tsx)
- [site/dashboard-banner.tsx](../src/components/site/dashboard-banner.tsx)
- [site/maintenance-bypass-pill.tsx](../src/components/site/maintenance-bypass-pill.tsx)
- [site/marketing-bypass-pill.tsx](../src/components/site/marketing-bypass-pill.tsx)
- [site/marketing-notices.tsx](../src/components/site/marketing-notices.tsx)
- [site/notice-stack.tsx](../src/components/site/notice-stack.tsx)
- [site/platform-banner.tsx](../src/components/site/platform-banner.tsx)
- [site/status-maintenance-card.tsx](../src/components/site/status-maintenance-card.tsx)

### status

- [status/status-parts.tsx](../src/components/status/status-parts.tsx)

### support

- [support/help-view.tsx](../src/components/support/help-view.tsx)
- [support/new-ticket-form.tsx](../src/components/support/new-ticket-form.tsx)
- [support/support-deep-link.tsx](../src/components/support/support-deep-link.tsx)
- [support/support-popout.tsx](../src/components/support/support-popout.tsx)
- [support/system-status-view.tsx](../src/components/support/system-status-view.tsx)
- [support/ticket-conversation.tsx](../src/components/support/ticket-conversation.tsx)
- [support/ticket-list.tsx](../src/components/support/ticket-list.tsx)

### system-check

- [system-check/lead-why-card.tsx](../src/components/system-check/lead-why-card.tsx)
- [system-check/system-check-report.tsx](../src/components/system-check/system-check-report.tsx)

### tour

- [tour/coachmark.tsx](../src/components/tour/coachmark.tsx)
- [tour/product-tour.tsx](../src/components/tour/product-tour.tsx)
- [tour/replay-tour-button.tsx](../src/components/tour/replay-tour-button.tsx)

### ui

- [ui/avatar.tsx](../src/components/ui/avatar.tsx)
- [ui/badge.tsx](../src/components/ui/badge.tsx)
- [ui/button.tsx](../src/components/ui/button.tsx)
- [ui/card.tsx](../src/components/ui/card.tsx)
- [ui/data-table.tsx](../src/components/ui/data-table.tsx)
- [ui/drawer.tsx](../src/components/ui/drawer.tsx)
- [ui/dropdown.tsx](../src/components/ui/dropdown.tsx)
- [ui/feedback.tsx](../src/components/ui/feedback.tsx)
- [ui/form.tsx](../src/components/ui/form.tsx)
- [ui/logo.tsx](../src/components/ui/logo.tsx)
- [ui/modal.tsx](../src/components/ui/modal.tsx)
- [ui/pagination.tsx](../src/components/ui/pagination.tsx)
- [ui/popover.tsx](../src/components/ui/popover.tsx)
- [ui/progress.tsx](../src/components/ui/progress.tsx)
- [ui/route-error.tsx](../src/components/ui/route-error.tsx)
- [ui/scroll-region.tsx](../src/components/ui/scroll-region.tsx)
- [ui/search-input.tsx](../src/components/ui/search-input.tsx)
- [ui/select.tsx](../src/components/ui/select.tsx)
- [ui/skeleton-page.tsx](../src/components/ui/skeleton-page.tsx)
- [ui/skip-link.tsx](../src/components/ui/skip-link.tsx)
- [ui/stat-card.tsx](../src/components/ui/stat-card.tsx)
- [ui/table.tsx](../src/components/ui/table.tsx)
- [ui/tabs.tsx](../src/components/ui/tabs.tsx)
- [ui/toast.tsx](../src/components/ui/toast.tsx)
- [ui/tooltip.tsx](../src/components/ui/tooltip.tsx)
- [ui/view-toggle.tsx](../src/components/ui/view-toggle.tsx)

### voice

- [voice/call-card.tsx](../src/components/voice/call-card.tsx)
- [voice/call-with-ai-button.tsx](../src/components/voice/call-with-ai-button.tsx)
- [voice/lead-voice-card.tsx](../src/components/voice/lead-voice-card.tsx)

## Route-local UI components

Forms and section renderers beside pages, outside the shared component directory. Framework page/layout/loading/error files are already represented by their route or shared shell.

- [(app)/app/settings/_sections/ai-selling-section.tsx](../src/app/(app)/app/settings/_sections/ai-selling-section.tsx)
- [(app)/app/settings/_sections/billing-section.tsx](../src/app/(app)/app/settings/_sections/billing-section.tsx)
- [(app)/app/settings/_sections/business-profile-section.tsx](../src/app/(app)/app/settings/_sections/business-profile-section.tsx)
- [(app)/app/settings/_sections/connections-section.tsx](../src/app/(app)/app/settings/_sections/connections-section.tsx)
- [(app)/app/settings/_sections/data-controls-section.tsx](../src/app/(app)/app/settings/_sections/data-controls-section.tsx)
- [(app)/app/settings/_sections/developer-section.tsx](../src/app/(app)/app/settings/_sections/developer-section.tsx)
- [(app)/app/settings/_sections/quotes-section.tsx](../src/app/(app)/app/settings/_sections/quotes-section.tsx)
- [(app)/app/settings/_sections/security-section.tsx](../src/app/(app)/app/settings/_sections/security-section.tsx)
- [(app)/app/settings/_sections/system-check-section.tsx](../src/app/(app)/app/settings/_sections/system-check-section.tsx)
- [(app)/app/settings/_sections/team-section.tsx](../src/app/(app)/app/settings/_sections/team-section.tsx)
- [(app)/app/settings/_sections/voice-section.tsx](../src/app/(app)/app/settings/_sections/voice-section.tsx)
- [(app)/app/settings/_sections/workspace-section.tsx](../src/app/(app)/app/settings/_sections/workspace-section.tsx)
- [(auth)/_components/auth-form-parts.tsx](../src/app/(auth)/_components/auth-form-parts.tsx)
- [(auth)/forgot-password/forgot-password-form.tsx](../src/app/(auth)/forgot-password/forgot-password-form.tsx)
- [(auth)/login/login-form.tsx](../src/app/(auth)/login/login-form.tsx)
- [(auth)/reset-password/reset-password-form.tsx](../src/app/(auth)/reset-password/reset-password-form.tsx)
- [(auth)/signup/signup-form.tsx](../src/app/(auth)/signup/signup-form.tsx)
- [(auth)/verify-email/resend-verification.tsx](../src/app/(auth)/verify-email/resend-verification.tsx)
- [admin/login/login-form.tsx](../src/app/admin/login/login-form.tsx)
- [affiliates/login/login-form.tsx](../src/app/affiliates/login/login-form.tsx)
- [affiliates/signup/signup-form.tsx](../src/app/affiliates/signup/signup-form.tsx)
- [opengraph-image.tsx](../src/app/opengraph-image.tsx)

## Individual help articles

Each article corresponds to `/help/<category>/<slug>` and `/app/help/<category>/<slug>` route templates.

- **ai-agents** / [Agents run 24/7](../content/help/ai-agents/agents-run-24-7.md) ? `/help/ai-agents/agents-run-24-7`
- **ai-agents** / [Setting up AI agents](../content/help/ai-agents/ai-agents-setup.md) ? `/help/ai-agents/ai-agents-setup`
- **ai-agents** / [AI budgets and model tiers, in plain words](../content/help/ai-agents/ai-budgets-and-model-tiers.md) ? `/help/ai-agents/ai-budgets-and-model-tiers`
- **ai-agents** / [AI guides and best practice](../content/help/ai-agents/ai-guides-best-practice.md) ? `/help/ai-agents/ai-guides-best-practice`
- **ai-agents** / [Setting up an agent](../content/help/ai-agents/setting-up-an-agent.md) ? `/help/ai-agents/setting-up-an-agent`
- **ai-agents** / [The conversation assistant](../content/help/ai-agents/the-conversation-assistant.md) ? `/help/ai-agents/the-conversation-assistant`
- **ai-agents** / [What are AI agents?](../content/help/ai-agents/what-are-ai-agents.md) ? `/help/ai-agents/what-are-ai-agents`
- **ai-agents** / [How the assistant writes](../content/help/ai-agents/writing-style.md) ? `/help/ai-agents/writing-style`
- **billing** / [Changing your plan](../content/help/billing/changing-your-plan.md) ? `/help/billing/changing-your-plan`
- **billing** / [What happens if a payment fails](../content/help/billing/failed-payments.md) ? `/help/billing/failed-payments`
- **billing** / [Your free trial](../content/help/billing/free-trial.md) ? `/help/billing/free-trial`
- **billing** / [Plans and what each includes](../content/help/billing/plans-and-pricing.md) ? `/help/billing/plans-and-pricing`
- **billing** / [Top-up credits for AI, SMS and WhatsApp](../content/help/billing/top-up-credits.md) ? `/help/billing/top-up-credits`
- **billing** / [Usage and limits](../content/help/billing/usage-and-limits.md) ? `/help/billing/usage-and-limits`
- **booking-and-sales** / [Abandoned checkout follow-up](../content/help/booking-and-sales/abandoned-checkout.md) ? `/help/booking-and-sales/abandoned-checkout`
- **booking-and-sales** / [Booking with Calendly](../content/help/booking-and-sales/booking-with-calendly.md) ? `/help/booking-and-sales/booking-with-calendly`
- **booking-and-sales** / [Booking with Google Calendar](../content/help/booking-and-sales/booking-with-google-calendar.md) ? `/help/booking-and-sales/booking-with-google-calendar`
- **booking-and-sales** / [Direct close with checkout links](../content/help/booking-and-sales/direct-close-checkout-links.md) ? `/help/booking-and-sales/direct-close-checkout-links`
- **booking-and-sales** / [E-signatures on quotes](../content/help/booking-and-sales/e-signatures.md) ? `/help/booking-and-sales/e-signatures`
- **booking-and-sales** / [The handoff brief](../content/help/booking-and-sales/handoff-brief.md) ? `/help/booking-and-sales/handoff-brief`
- **booking-and-sales** / [Invoices from a signed quote](../content/help/booking-and-sales/invoices.md) ? `/help/booking-and-sales/invoices`
- **booking-and-sales** / [Managing bookings](../content/help/booking-and-sales/managing-bookings.md) ? `/help/booking-and-sales/managing-bookings`
- **booking-and-sales** / [Manual bookings and confirmation](../content/help/booking-and-sales/manual-bookings-and-confirmation.md) ? `/help/booking-and-sales/manual-bookings-and-confirmation`
- **booking-and-sales** / [Meeting types and routing](../content/help/booking-and-sales/meeting-types-and-routing.md) ? `/help/booking-and-sales/meeting-types-and-routing`
- **booking-and-sales** / [Opportunities, won and lost](../content/help/booking-and-sales/opportunities-and-won-lost.md) ? `/help/booking-and-sales/opportunities-and-won-lost`
- **booking-and-sales** / [Payment confirmation and the thank-you](../content/help/booking-and-sales/payment-confirmation.md) ? `/help/booking-and-sales/payment-confirmation`
- **booking-and-sales** / [Quotes from your catalogue](../content/help/booking-and-sales/quotes.md) ? `/help/booking-and-sales/quotes`
- **booking-and-sales** / [Taking over a conversation](../content/help/booking-and-sales/taking-over-a-conversation.md) ? `/help/booking-and-sales/taking-over-a-conversation`
- **compliance** / [Telling people where you got their details (Article 14)](../content/help/compliance/article-14-source-disclosure.md) ? `/help/compliance/article-14-source-disclosure`
- **compliance** / [Compliance overview](../content/help/compliance/compliance-overview.md) ? `/help/compliance/compliance-overview`
- **compliance** / [Consent and WhatsApp opt-in](../content/help/compliance/consent-and-whatsapp-opt-in.md) ? `/help/compliance/consent-and-whatsapp-opt-in`
- **compliance** / [Corporate and individual subscribers (sole traders, partnerships, LLPs)](../content/help/compliance/corporate-and-individual-subscribers.md) ? `/help/compliance/corporate-and-individual-subscribers`
- **compliance** / [Data rights: archive, suppress, anonymise, erase and export](../content/help/compliance/data-rights.md) ? `/help/compliance/data-rights`
- **compliance** / [LinkedIn and social messages](../content/help/compliance/linkedin-and-social-messages.md) ? `/help/compliance/linkedin-and-social-messages`
- **compliance** / [LinkedIn, Instagram, Messenger and TikTok conversations](../content/help/compliance/social-conversations-by-channel.md) ? `/help/compliance/social-conversations-by-channel`
- **compliance** / [Suppression, STOP and unsubscribe](../content/help/compliance/suppression-and-unsubscribe.md) ? `/help/compliance/suppression-and-unsubscribe`
- **copilot** / [Copilot example prompts](../content/help/copilot/copilot-example-prompts.md) ? `/help/copilot/copilot-example-prompts`
- **copilot** / [Your first Copilot session](../content/help/copilot/copilot-first-setup.md) ? `/help/copilot/copilot-first-setup`
- **copilot** / [Using Copilot](../content/help/copilot/using-copilot.md) ? `/help/copilot/using-copilot`
- **developers** / [Creating leads with the API](../content/help/developers/api-create-leads.md) ? `/help/developers/api-create-leads`
- **developers** / [API keys: reading your workspace from your own systems](../content/help/developers/api-keys.md) ? `/help/developers/api-keys`
- **developers** / [API overview and authentication](../content/help/developers/api-overview-and-authentication.md) ? `/help/developers/api-overview-and-authentication`
- **developers** / [Reading and updating leads with the API](../content/help/developers/api-reading-and-updating-leads.md) ? `/help/developers/api-reading-and-updating-leads`
- **developers** / [Connecting an AI assistant (MCP)](../content/help/developers/connect-an-ai-assistant.md) ? `/help/developers/connect-an-ai-assistant`
- **developers** / [MCP tools and approvals](../content/help/developers/mcp-tools-and-approvals.md) ? `/help/developers/mcp-tools-and-approvals`
- **developers** / [Setting up a webhook](../content/help/developers/setting-up-a-webhook.md) ? `/help/developers/setting-up-a-webhook`
- **developers** / [Webhooks: being told the moment something happens](../content/help/developers/webhooks.md) ? `/help/developers/webhooks`
- **faq** / [Frequently asked questions](../content/help/faq/faq.md) ? `/help/faq/faq`
- **finding-leads** / [Adding a lead manually](../content/help/finding-leads/adding-a-lead-manually.md) ? `/help/finding-leads/adding-a-lead-manually`
- **finding-leads** / [Bulk actions on leads](../content/help/finding-leads/bulk-actions-on-leads.md) ? `/help/finding-leads/bulk-actions-on-leads`
- **finding-leads** / [Cold email that gets replies (and stays legal)](../content/help/finding-leads/cold-email-that-gets-replies.md) ? `/help/finding-leads/cold-email-that-gets-replies`
- **finding-leads** / [Discovering companies with Find Leads](../content/help/finding-leads/find-leads-discovery.md) ? `/help/finding-leads/find-leads-discovery`
- **finding-leads** / [Finding and sourcing leads](../content/help/finding-leads/finding-and-sourcing-leads.md) ? `/help/finding-leads/finding-and-sourcing-leads`
- **finding-leads** / [Getting leads from Google Ads lead forms](../content/help/finding-leads/google-ads-lead-forms.md) ? `/help/finding-leads/google-ads-lead-forms`
- **finding-leads** / [Importing leads from a CSV file](../content/help/finding-leads/importing-a-csv.md) ? `/help/finding-leads/importing-a-csv`
- **finding-leads** / [Intent signals explained](../content/help/finding-leads/intent-signals-explained.md) ? `/help/finding-leads/intent-signals-explained`
- **finding-leads** / [Lead sources explained](../content/help/finding-leads/lead-sources-explained.md) ? `/help/finding-leads/lead-sources-explained`
- **finding-leads** / [Adding leads from an AI assistant (MCP)](../content/help/finding-leads/leads-from-mcp.md) ? `/help/finding-leads/leads-from-mcp`
- **finding-leads** / [Sending leads in from your own software (API)](../content/help/finding-leads/leads-from-the-api.md) ? `/help/finding-leads/leads-from-the-api`
- **finding-leads** / [Bringing contacts in from Zapier, Pipedrive and webhooks](../content/help/finding-leads/leads-from-zapier-and-webhooks.md) ? `/help/finding-leads/leads-from-zapier-and-webhooks`
- **finding-leads** / [LinkedIn Assist](../content/help/finding-leads/linkedin-assist.md) ? `/help/finding-leads/linkedin-assist`
- **finding-leads** / [LinkedIn company-page engagement](../content/help/finding-leads/linkedin-company-page-engagement.md) ? `/help/finding-leads/linkedin-company-page-engagement`
- **finding-leads** / [Getting leads from LinkedIn Lead Gen Forms](../content/help/finding-leads/linkedin-lead-gen-forms.md) ? `/help/finding-leads/linkedin-lead-gen-forms`
- **finding-leads** / [LinkedIn Sales Navigator, assisted](../content/help/finding-leads/linkedin-sales-navigator-assisted.md) ? `/help/finding-leads/linkedin-sales-navigator-assisted`
- **finding-leads** / [Getting leads from Meta Lead Ads](../content/help/finding-leads/meta-lead-ads.md) ? `/help/finding-leads/meta-lead-ads`
- **finding-leads** / [Importing new contacts from your CRM](../content/help/finding-leads/pulling-leads-from-your-crm.md) ? `/help/finding-leads/pulling-leads-from-your-crm`
- **finding-leads** / [Reaching the decision maker](../content/help/finding-leads/reaching-the-decision-maker.md) ? `/help/finding-leads/reaching-the-decision-maker`
- **finding-leads** / [The lead page](../content/help/finding-leads/the-lead-page.md) ? `/help/finding-leads/the-lead-page`
- **finding-leads** / [Getting leads from TikTok lead forms](../content/help/finding-leads/tiktok-lead-forms.md) ? `/help/finding-leads/tiktok-lead-forms`
- **getting-started** / [Your first week with ClientTurn](../content/help/getting-started/first-week-guide.md) ? `/help/getting-started/first-week-guide`
- **getting-started** / [Getting started with ClientTurn](../content/help/getting-started/getting-started.md) ? `/help/getting-started/getting-started`
- **getting-started** / [Setting up your workspace](../content/help/getting-started/setting-up-your-workspace.md) ? `/help/getting-started/setting-up-your-workspace`
- **getting-started** / [The product tour](../content/help/getting-started/the-product-tour.md) ? `/help/getting-started/the-product-tour`
- **integrations** / [Connecting Calendly](../content/help/integrations/connecting-calendly.md) ? `/help/integrations/connecting-calendly`
- **integrations** / [Connecting Google Ads](../content/help/integrations/connecting-google-ads.md) ? `/help/integrations/connecting-google-ads`
- **integrations** / [Connecting Google Calendar](../content/help/integrations/connecting-google-calendar.md) ? `/help/integrations/connecting-google-calendar`
- **integrations** / [Connecting HubSpot](../content/help/integrations/connecting-hubspot.md) ? `/help/integrations/connecting-hubspot`
- **integrations** / [Connecting LinkedIn](../content/help/integrations/connecting-linkedin.md) ? `/help/integrations/connecting-linkedin`
- **integrations** / [Connecting Meta (Facebook and Instagram)](../content/help/integrations/connecting-meta.md) ? `/help/integrations/connecting-meta`
- **integrations** / [Connecting other CRMs and automation tools (Make, n8n, custom)](../content/help/integrations/connecting-pipedrive-and-other-crms.md) ? `/help/integrations/connecting-pipedrive-and-other-crms`
- **integrations** / [Connecting Pipedrive](../content/help/integrations/connecting-pipedrive.md) ? `/help/integrations/connecting-pipedrive`
- **integrations** / [Connecting Salesforce](../content/help/integrations/connecting-salesforce.md) ? `/help/integrations/connecting-salesforce`
- **integrations** / [Connecting Slack](../content/help/integrations/connecting-slack.md) ? `/help/integrations/connecting-slack`
- **integrations** / [SMS and WhatsApp (Twilio)](../content/help/integrations/connecting-twilio-sms-and-whatsapp.md) ? `/help/integrations/connecting-twilio-sms-and-whatsapp`
- **integrations** / [Connecting Zapier](../content/help/integrations/connecting-zapier.md) ? `/help/integrations/connecting-zapier`
- **integrations** / [Connecting Zoho CRM](../content/help/integrations/connecting-zoho-crm.md) ? `/help/integrations/connecting-zoho-crm`
- **integrations** / [Integrating with your CRM](../content/help/integrations/integrating-with-your-crm.md) ? `/help/integrations/integrating-with-your-crm`
- **integrations** / [Setting up email outreach](../content/help/integrations/setting-up-email-outreach.md) ? `/help/integrations/setting-up-email-outreach`
- **integrations** / [Troubleshooting integrations](../content/help/integrations/troubleshooting-integrations.md) ? `/help/integrations/troubleshooting-integrations`
- **integrations** / [WhatsApp templates](../content/help/integrations/whatsapp-templates.md) ? `/help/integrations/whatsapp-templates`
- **qualifying** / [Buying intent explained](../content/help/qualifying/buying-intent-explained.md) ? `/help/qualifying/buying-intent-explained`
- **qualifying** / [Correcting what is known about a lead](../content/help/qualifying/correcting-qualification.md) ? `/help/qualifying/correcting-qualification`
- **qualifying** / [How qualification works](../content/help/qualifying/how-qualification-works.md) ? `/help/qualifying/how-qualification-works`
- **qualifying** / [Lead scoring explained](../content/help/qualifying/lead-scoring-explained.md) ? `/help/qualifying/lead-scoring-explained`
- **qualifying** / [Lead tags](../content/help/qualifying/lead-tags.md) ? `/help/qualifying/lead-tags`
- **qualifying** / [The next best action](../content/help/qualifying/next-best-action.md) ? `/help/qualifying/next-best-action`
- **qualifying** / [Your qualification policy](../content/help/qualifying/qualification-policy.md) ? `/help/qualifying/qualification-policy`
- **qualifying** / [Setting up qualification questions](../content/help/qualifying/setting-up-qualification-questions.md) ? `/help/qualifying/setting-up-qualification-questions`
- **reactivation** / [Re-engagement check-ins, no-shows and win-back](../content/help/reactivation/re-engagement.md) ? `/help/reactivation/re-engagement`
- **reactivation** / [Reactivating a CSV list](../content/help/reactivation/reactivating-a-csv-list.md) ? `/help/reactivation/reactivating-a-csv-list`
- **reactivation** / [Reactivating existing leads](../content/help/reactivation/reactivating-existing-leads.md) ? `/help/reactivation/reactivating-existing-leads`
- **reactivation** / [Reactivation overview](../content/help/reactivation/reactivation-overview.md) ? `/help/reactivation/reactivation-overview`
- **reactivation** / [SMS reactivation](../content/help/reactivation/sms-reactivation.md) ? `/help/reactivation/sms-reactivation`
- **reactivation** / [WhatsApp templates for reactivation](../content/help/reactivation/whatsapp-templates-for-reactivation.md) ? `/help/reactivation/whatsapp-templates-for-reactivation`
- **reactivation** / [Who reactivation will not contact](../content/help/reactivation/who-reactivation-will-not-contact.md) ? `/help/reactivation/who-reactivation-will-not-contact`
- **README.md** / [Help-centre content contract](../content/help/README.md) ? `/help/README`
- **sales-knowledge** / [Industry scoring and business types](../content/help/sales-knowledge/industry-scoring-and-archetypes.md) ? `/help/sales-knowledge/industry-scoring-and-archetypes`
- **sales-knowledge** / [Objection handling](../content/help/sales-knowledge/objection-handling.md) ? `/help/sales-knowledge/objection-handling`
- **sales-knowledge** / [Sales methods explained](../content/help/sales-knowledge/sales-methods-explained.md) ? `/help/sales-knowledge/sales-methods-explained`
- **sales-knowledge** / [Sales motions and close targets](../content/help/sales-knowledge/sales-motions-and-close-targets.md) ? `/help/sales-knowledge/sales-motions-and-close-targets`
- **sales-knowledge** / [Sales psychology: what the evidence supports](../content/help/sales-knowledge/sales-psychology-evidence.md) ? `/help/sales-knowledge/sales-psychology-evidence`
- **SCREENSHOTS.md** / [Help-centre screenshot shot list](../content/help/SCREENSHOTS.md) ? `/help/SCREENSHOTS`
- **settings** / [AI & selling settings](../content/help/settings/ai-and-selling-settings.md) ? `/help/settings/ai-and-selling-settings`
- **settings** / [Billing & Usage settings](../content/help/settings/billing-and-usage-settings.md) ? `/help/settings/billing-and-usage-settings`
- **settings** / [Business Profile settings](../content/help/settings/business-profile-settings.md) ? `/help/settings/business-profile-settings`
- **settings** / [Connections settings](../content/help/settings/connections-settings.md) ? `/help/settings/connections-settings`
- **settings** / [Data Controls settings](../content/help/settings/data-controls-settings.md) ? `/help/settings/data-controls-settings`
- **settings** / [Developer settings](../content/help/settings/developer-settings.md) ? `/help/settings/developer-settings`
- **settings** / [Security settings](../content/help/settings/security-settings.md) ? `/help/settings/security-settings`
- **settings** / [Team settings](../content/help/settings/team-settings.md) ? `/help/settings/team-settings`
- **settings** / [Workspace settings](../content/help/settings/workspace-settings.md) ? `/help/settings/workspace-settings`
- **troubleshooting** / [AI calls aren't ringing](../content/help/troubleshooting/ai-calls-arent-ringing.md) ? `/help/troubleshooting/ai-calls-arent-ringing`
- **troubleshooting** / [The AI isn't replying to leads](../content/help/troubleshooting/ai-isnt-replying.md) ? `/help/troubleshooting/ai-isnt-replying`
- **troubleshooting** / [Bookings aren't being offered](../content/help/troubleshooting/bookings-arent-being-offered.md) ? `/help/troubleshooting/bookings-arent-being-offered`
- **troubleshooting** / [Emails are bouncing or not sending](../content/help/troubleshooting/emails-are-bouncing.md) ? `/help/troubleshooting/emails-are-bouncing`
- **troubleshooting** / [Find Leads returns nothing](../content/help/troubleshooting/find-leads-returns-nothing.md) ? `/help/troubleshooting/find-leads-returns-nothing`
- **troubleshooting** / [Follow-ups stopped](../content/help/troubleshooting/follow-ups-stopped.md) ? `/help/troubleshooting/follow-ups-stopped`
- **troubleshooting** / [Leads aren't arriving from Meta or Google](../content/help/troubleshooting/leads-arent-arriving.md) ? `/help/troubleshooting/leads-arent-arriving`
- **troubleshooting** / [Using System check to find out why something isn't working](../content/help/troubleshooting/using-system-check.md) ? `/help/troubleshooting/using-system-check`
- **voice** / [Calls and consent](../content/help/voice/calls-and-consent.md) ? `/help/voice/calls-and-consent`
- **voice** / [Setting up the AI voice agent](../content/help/voice/setting-up-the-ai-voice-agent.md) ? `/help/voice/setting-up-the-ai-voice-agent`
- **voice** / [Voice minutes and billing](../content/help/voice/voice-minutes-and-billing.md) ? `/help/voice/voice-minutes-and-billing`
