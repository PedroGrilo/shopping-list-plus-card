# Shopping List Plus Card

A custom Lovelace card for Home Assistant that sits on top of a native `todo`
entity (e.g. `todo.shopping_list`) and adds search, tag-based filtering and
category grouping — no backend integration required.

Tags are written with `#` inside the item name, e.g. `Milk #dairy #store`.
The card parses them, shows a clean name plus badges, and builds filter chips
automatically. Tags are stored in the item `summary`, so they round-trip and
remain visible anywhere else in Home Assistant.

## Features

- Real-time updates via the `todo/item/subscribe` WebSocket command (with a
  `todo/item/list` fallback).
- `#tag` → category. Filter chips are generated automatically, including a
  "no category" chip.
- Search, multi-tag filtering (OR), group-by-category, and show/hide completed.
- Toggle and delete per item; add with Enter.
- Filter preferences persisted in `localStorage`, per entity.
- Themed with Home Assistant CSS variables; optional `accent_color`.

## Installation (HACS)

1. In HACS, open the three-dot menu → **Custom repositories**.
2. Add the repository URL and select **Dashboard** as the type.
3. Click **Add**, then find "Shopping List Plus Card" and **Download** it.
4. Reload the browser with a hard refresh (Ctrl/Cmd + Shift + R).

In storage mode, HACS registers the resource automatically as
`/hacsfiles/shopping-list-plus-card/shopping-list-plus-card.js`.
In YAML mode, add it manually under `resources` with `type: module`.

## Configuration

```yaml
type: custom:shopping-list-plus-card
entity: todo.shopping_list
title: Shopping
accent_color: "#d99a2b"   # optional, default = theme primary color
group_by_category: false  # optional
show_completed: true       # optional
```

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `entity` | yes | – | A `todo.` entity id |
| `title` | no | `Compras` | Card header title |
| `accent_color` | no | theme primary | Accent for checks, chips, add button |
| `group_by_category` | no | `false` | Group items under their first tag |
| `show_completed` | no | `true` | Show completed items |

## Usage

Add items with tags to categorise them:

```
Milk #dairy
Bread #bakery #lidl
Batteries
```

The card strips the `#tags` from the displayed name, renders them as badges,
and lets you filter by tapping the chips.
