import {
  Bolt,
  LayoutGrid,
  Package,
  ScrollText,
  Settings,
  Shield,
  ShieldUser,
  Theater,
  UserCircle,
  Users,
} from "lucide-react";

import type { MenuConfig } from "@schoolhub/ui";

// Ported from Metronic's own config/menu.config.tsx + config/types.ts (the full
// original Next.js template) — trimmed to just MENU_SIDEBAR, the one export
// Demo1's sidebar renders. The mega-menu (MENU_MEGA/MENU_MEGA_MOBILE) was
// dropped along with the mega-menu components themselves — it duplicated this
// same sidebar nav with more of Metronic's demo content, adding nothing once
// the sidebar became the real nav. Unused demo variants (compact/custom
// sidebars, help menu, root menu) were dropped for the same reason: nothing
// here renders them. MenuItem/MenuConfig themselves live in @schoolhub/ui —
// a generic tree-menu shape, not specific to this app's own nav data below.

export const MENU_SIDEBAR: MenuConfig = [
  {
    title: "Dashboards",
    icon: LayoutGrid,
    children: [
      { title: "Light Sidebar", path: "/dashboard" },
      { title: "Dark Sidebar", path: "/dev/metronic-demo1/dark-sidebar" },
    ],
  },
  { heading: "User" },
  {
    title: "Public Profile",
    icon: UserCircle,
    children: [
      {
        title: "Profiles",
        children: [
          { title: "Default", path: "/public-profile/profiles/default" },
          { title: "Creator", path: "/public-profile/profiles/creator" },
          { title: "Company", path: "/public-profile/profiles/company" },
          { title: "NFT", path: "/public-profile/profiles/nft" },
          { title: "Blogger", path: "/public-profile/profiles/blogger" },
          { title: "CRM", path: "/public-profile/profiles/crm" },
          {
            title: "More",
            collapse: true,
            collapseTitle: "Show less",
            expandTitle: "Show 4 more",
            children: [
              { title: "Gamer", path: "/public-profile/profiles/gamer" },
              { title: "Feeds", path: "/public-profile/profiles/feeds" },
              { title: "Plain", path: "/public-profile/profiles/plain" },
              { title: "Modal", path: "/public-profile/profiles/modal" },
            ],
          },
        ],
      },
      {
        title: "Projects",
        children: [
          { title: "3 Columns", path: "/public-profile/projects/3-columns" },
          { title: "2 Columns", path: "/public-profile/projects/2-columns" },
        ],
      },
      { title: "Works", path: "/public-profile/works" },
      { title: "Teams", path: "/public-profile/teams" },
      { title: "Network", path: "/public-profile/network" },
      { title: "Activity", path: "/public-profile/activity" },
      {
        title: "More",
        collapse: true,
        collapseTitle: "Show less",
        expandTitle: "Show 3 more",
        children: [
          { title: "Campaigns - Card", path: "/public-profile/campaigns/card" },
          { title: "Campaigns - List", path: "/public-profile/campaigns/list" },
          { title: "Empty", path: "/public-profile/empty" },
        ],
      },
    ],
  },
  {
    title: "My Account",
    icon: Settings,
    children: [
      {
        title: "Account",
        children: [
          { title: "Get Started", path: "/account/home/get-started" },
          { title: "User Profile", path: "/account/home/user-profile" },
          { title: "Company Profile", path: "/account/home/company-profile" },
          { title: "Settings - With Sidebar", path: "/account/home/settings-sidebar" },
          { title: "Settings - Enterprise", path: "/account/home/settings-enterprise" },
          { title: "Settings - Plain", path: "/account/home/settings-plain" },
          { title: "Settings - Modal", path: "/account/home/settings-modal" },
        ],
      },
      {
        title: "Billing",
        children: [
          { title: "Billing - Basic", path: "/account/billing/basic" },
          { title: "Billing - Enterprise", path: "/account/billing/enterprise" },
          { title: "Plans", path: "/account/billing/plans" },
          { title: "Billing History", path: "/account/billing/history" },
        ],
      },
      {
        title: "Security",
        children: [
          { title: "Get Started", path: "/account/security/get-started" },
          { title: "Security Overview", path: "/account/security/overview" },
          { title: "Allowed IP Addresses", path: "/account/security/allowed-ip-addresses" },
          { title: "Privacy Settings", path: "/account/security/privacy-settings" },
          { title: "Device Management", path: "/account/security/device-management" },
          { title: "Backup & Recovery", path: "/account/security/backup-and-recovery" },
          { title: "Current Sessions", path: "/account/security/current-sessions" },
          { title: "Security Log", path: "/account/security/security-log" },
        ],
      },
      {
        title: "Members & Roles",
        children: [
          { title: "Teams Starter", path: "/account/members/team-starter" },
          { title: "Teams", path: "/account/members/teams" },
          { title: "Team Info", path: "/account/members/team-info" },
          { title: "Members Starter", path: "/account/members/members-starter" },
          { title: "Team Members", path: "/account/members/team-members" },
          { title: "Import Members", path: "/account/members/import-members" },
          { title: "Roles", path: "/account/members/roles" },
          { title: "Permissions - Toggler", path: "/account/members/permissions-toggle" },
          { title: "Permissions - Check", path: "/account/members/permissions-check" },
        ],
      },
      { title: "Integrations", path: "/account/integrations" },
      { title: "Notifications", path: "/account/notifications" },
      { title: "API Keys", path: "/account/api-keys" },
      {
        title: "More",
        collapse: true,
        collapseTitle: "Show less",
        expandTitle: "Show 3 more",
        children: [
          { title: "Appearance", path: "/account/appearance" },
          { title: "Invite a Friend", path: "/account/invite-a-friend" },
          { title: "Activity", path: "/account/activity" },
        ],
      },
    ],
  },
  {
    title: "Network",
    icon: Users,
    children: [
      { title: "Get Started", path: "/network/get-started" },
      {
        title: "User Cards",
        children: [
          { title: "Mini Cards", path: "/network/user-cards/mini-cards" },
          { title: "Team Crew", path: "/network/user-cards/team-crew" },
          { title: "Author", path: "/network/user-cards/author" },
          { title: "NFT", path: "/network/user-cards/nft" },
          { title: "Social", path: "/network/user-cards/social" },
        ],
      },
      {
        title: "User Table",
        children: [
          { title: "Team Crew", path: "/network/user-table/team-crew" },
          { title: "App Roster", path: "/network/user-table/app-roster" },
          { title: "Market Authors", path: "/network/user-table/market-authors" },
          { title: "SaaS Users", path: "/network/user-table/saas-users" },
          { title: "Store Clients", path: "/network/user-table/store-clients" },
          { title: "Visitors", path: "/network/user-table/visitors" },
        ],
      },
      { title: "Cooperations", path: "/network/cooperations", disabled: true },
      { title: "Leads", path: "/network/leads", disabled: true },
      { title: "Donators", path: "/network/donators", disabled: true },
    ],
  },
  {
    title: "Authentication",
    icon: Shield,
    children: [
      { title: "Sign In", path: "/signin" },
      { title: "Check Email", path: "/signup" },
      { title: "Reset Password", path: "/reset-password" },
      { title: "2FA", path: "/2fa" },
      { title: "Welcome Message", path: "/auth/welcome-message" },
      { title: "Account Deactivated", path: "/auth/account-deactivated" },
      { title: "Error 404", path: "/error/404" },
      { title: "Error 500", path: "/error/500" },
    ],
  },
  { heading: "Apps" },
  {
    title: "User Management",
    icon: ShieldUser,
    children: [
      { title: "Users", path: "/user-management/users" },
      { title: "Roles", path: "/user-management/roles" },
      { title: "Permissions", path: "/user-management/permissions" },
      { title: "Account", path: "/user-management/account" },
      { title: "Logs", path: "/user-management/logs" },
      { title: "Settings", path: "/user-management/settings" },
    ],
  },
  {
    title: "Store - Client",
    icon: Users,
    children: [
      { title: "Home", path: "/store-client/home" },
      { title: "Search Results - Grid", path: "/store-client/search-results-grid" },
      { title: "Search Results - List", path: "/store-client/search-results-list" },
      { title: "Product Details", path: "/store-client/product-details" },
      { title: "Wishlist", path: "/store-client/wishlist" },
      {
        title: "Checkout",
        children: [
          { title: "Order Summary", path: "/store-client/checkout/order-summary" },
          { title: "Shipping Info", path: "/store-client/checkout/shipping-info" },
          { title: "Payment Method", path: "/store-client/checkout/payment-method" },
          { title: "Order Placed", path: "/store-client/checkout/order-placed" },
        ],
      },
      { title: "My Orders", path: "/store-client/my-orders" },
      { title: "Order Receipt", path: "/store-client/order-receipt" },
    ],
  },
  {
    title: "Store - Admin",
    icon: Bolt,
    disabled: true,
    children: [
      { title: "Dashboard", path: "/store-admin/dashboard" },
      {
        title: "Inventory",
        children: [
          { title: "All Products", path: "/store-admin/inventory/all-products" },
          { title: "Current Stock", path: "/store-admin/inventory/current-stock" },
          { title: "Inbound Stock", path: "/store-admin/inventory/inbound-stock" },
          { title: "Outbound Stock", path: "/store-admin/inventory/outbound-stock" },
          { title: "Stock Planner", path: "/store-admin/inventory/stock-planner" },
          { title: "Track Shipping", path: "/" },
          { title: "Create Shipping Label", path: "/" },
        ],
      },
    ],
  },
  { title: "Store - Services", icon: Package, disabled: true },
  { title: "AI Prompt", icon: Theater, disabled: true },
  { title: "Invoice Generator", icon: ScrollText, disabled: true },
];
