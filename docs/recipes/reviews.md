# Review sites and app stores

There is no direct connection, and none is planned: scraping and store APIs have terms and limits that differ by site.
- If the site offers an email or webhook notification for new reviews, point it at an automation service ([automation.md](automation.md)) and send each review to the [inbound endpoint](README.md): `source` the site's name, `externalId` the review id, `url` the review link, `title` the star rating and headline, `text` the review.
- Otherwise paste a batch of reviews on the Add page.
