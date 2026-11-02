# Website → app change list

The owner keeps improving the website while the app is built. Every website change the owner reports goes here, and
gets ticked when the app has it too. Newest at the top.

| Date | Website change | Where in the app | Done in app |
|---|---|---|---|
| — | *(nothing reported yet)* | | |

## How website changes reach the app

The app is built from the website's own files (`public/`). Any website change is in the next app build
(`cd app && npm run sync`) — nothing to copy by hand. Only the app additions (`app/additions/`) are app-specific.
