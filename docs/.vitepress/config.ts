import { defineConfig } from "vitepress";

export default defineConfig({
  title: "@wataruoguchi/emmett-libs",
  description: "Event sourcing libraries built on Emmett",
  // Note: When using custom domain (CNAME), base path should still be /emmett-libs/
  // if accessing via wataruoguchi.com/emmett-libs/
  // If accessing directly from root domain, change to "/"
  base: "/emmett-libs/", // GitHub Pages base path - must match repository name
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Event Store Kysely", link: "/emmett-event-store-kysely" },
      { text: "Crypto Shredding", link: "/emmett-crypto-shredding" },
      {
        text: "Crypto Shredding Kysely",
        link: "/emmett-crypto-shredding-kysely",
      },
    ],
    sidebar: [
      {
        text: "Packages",
        items: [
          { text: "Event Store Kysely", link: "/emmett-event-store-kysely" },
          { text: "Crypto Shredding", link: "/emmett-crypto-shredding" },
          {
            text: "Crypto Shredding Kysely",
            link: "/emmett-crypto-shredding-kysely",
          },
        ],
      },
    ],
    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/wataruoguchi/emmett-libs",
      },
    ],
    search: {
      provider: "local",
    },
  },
});
