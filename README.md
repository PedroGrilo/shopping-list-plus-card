# Shopping List Plus Card

A custom Lovelace card for Home Assistant that sits on top of a native `todo`
entity (e.g. `todo.lista_de_compras`) and makes it fast to build a shopping
list: recommendations, automatic categories, quantities, search and filters —
no backend integration required. The UI is in Portuguese.

## Features

- **Recommendations** ("Sugestões para ti"): one tap adds items you usually
  buy. The card learns how often you need each item and suggests it when it
  is due, plus items that usually go together with what is already on the
  list. Starts with a set of basics until it has history. Tap × to snooze one.
- **Automatic category**: typing "leite" fills in *Laticínios*. It uses your
  own history first, then a built-in Portuguese dictionary, and prefers the
  categories you already use. You can always change it.
- **Add several at once**: `leite, pão, 2x ovos` (commas, `;` or new lines).
- **Quantities**: type `2 ovos` / `2x ovos` or use the −/+ buttons.
- **No duplicates**: adding something already on the list increases its
  quantity; adding something already bought puts it back on the list.
- **Autocomplete** that ignores accents (`acucar` finds *Açúcar*).
- Tap a name to rename it; tap the category badge to change it.
- Undo for delete and for "Limpar comprados" (clear bought items).
- Search, category chips with counts, group by category, show/hide bought.
- A banner tells you when items are hidden by search/filters, with a
  "Mostrar tudo" button. Adding an item that a filter would hide clears the
  filters, so new items never "disappear".
- Reliable sync: real-time `todo/item/subscribe`; if the subscription is lost
  (HA restart, reconnect, app in background) the card notices that the
  entity's count no longer matches and reloads the list. Falls back to
  polling when real-time is not available (orange dot in the header).
- History is stored in the browser and in your HA user data, so it is shared
  between your devices.
- **Items added from outside the card** (Siri, the HA app, Assist, another
  device) are tidied up the next time the card sees them, even if it was
  closed: `Dois ovos.` becomes `2x ovos` with a category, a duplicate of
  something already on the list is merged into it, and the item counts
  towards the recommendations. Quantities in words are understood everywhere
  (`dois`, `três`, `meia dúzia de`, `uma dúzia de`…).
- **Categorizar (N)** button: guesses a category for items that have none.

## Adding with Siri

HomeKit/Homebridge only exposes devices, so use an Apple **Shortcut**
(the shortcut's name is what you say to Siri, e.g. "Lista de compras"):

1. **Dictate Text**.
2. **Replace Text** ` e ` → `,`, then **Split Text** by `,`, then
   **Repeat with Each**.
3. Inside the loop, the **Home Assistant** app action that performs an
   action/service: `todo.add_item` with
   `{"entity_id": "todo.lista_de_compras", "item": "[Repeat Item]"}`.

The card takes care of quantities, categories and duplicates.

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
entity: todo.lista_de_compras
title: Compras
accent_color: "#d99a2b"   # optional, default = theme primary color
group_by_category: false  # optional
show_completed: true      # optional
recommendations: 8        # optional, 0 = off
auto_category: true       # optional
```

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `entity` | yes | – | A `todo.` entity id |
| `title` | no | `Compras` | Card header title |
| `accent_color` | no | theme primary | Accent for checks, chips, add button |
| `group_by_category` | no | `false` | Group items by category |
| `show_completed` | no | `true` | Show bought (completed) items |
| `recommendations` | no | `8` | How many recommendations to show (`0` hides them) |
| `auto_category` | no | `true` | Guess the category from the item name |

Group/filter/show-bought choices made on the card are remembered per browser.

## Data model

- Name and quantity live in the item `summary` (`2x Ovos`).
- The category lives in the item `description`. If the list does not support
  descriptions, it is stored as a `[Category]` suffix in the name.
- Old `#tag` items are still read (the first tag becomes the category).
