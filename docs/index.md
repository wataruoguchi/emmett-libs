---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "@wataruoguchi"
  text: "/emmett-libs"
  tagline: "Event Sourcing Libraries built on Emmett"
  actions:
    - theme: brand
      text: "Event Store Kysely"
      link: /emmett-event-store-kysely
    - theme: brand
      text: "Crypto Shredding"
      link: /emmett-crypto-shredding

features:
  - title: Event Store for PostgreSQL
    details: Full-featured event store implementation with Kysely and PostgreSQL. Includes snapshot projections, event consumers, and multi-tenancy support.
    link: /emmett-event-store-kysely
    linkText: Learn more
  - title: Crypto Shredding
    details: Selective encryption for event streams with key management and crypto shredding capabilities for GDPR compliance and data protection.
    link: /emmett-crypto-shredding
    linkText: Learn more
  - title: Built on Emmett
    details: Fully compatible with Oskar Dudycz's Emmett event sourcing framework, following best practices and patterns for event-driven architecture.
    link: https://event-driven-io.github.io/emmett/
    linkText: Jump to Emmett's page
---

