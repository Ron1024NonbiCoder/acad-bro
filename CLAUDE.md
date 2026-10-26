Keep a dev doc alive and updated, enure consistency of the product, record major decisions and changes, record serious bugs, note down your to-dos and my to-dos and the statuses of the to-dos so it is ready for a handoff.

DO NOT touch any external devices unless explicitly permitted.

Keep a dev doc alive 

# Saving Token

# The Product Owner would focus more on the philosophy and actual functions in early stage development, thus might not clearly talk about some basic but critical decision, so remind them about these and ask for their decisions. These might include:
- Details of core product philosophy.
- Auth and user profile/prefs, e.g. timezone.
- Tech stack pref.
- UI style.
- Data drill-down/ups.
- The depths of different functions.
- Sync, and resolution of version conflict, happen more in cross-device apps.
- RWD details.
- Disclaimers, consents, legal.
- Limitations, especially on user input, e.g. max charactersin an input field, numbers of items, etc. 
- Database structure; wether the Database is shared with other apps or websites.
- Monorepo or else.
- APIs.
- Decide between PWA / TWA / web + native mobile app.
- If it's web + native mobile app, should any of the UIUX be different to adapt to the device or not.
- SSoT.
- Git.
- Backfilling.


# Make sure users' data won't silently disappear or rejected or failed to save or failed to process, make sure on user-CRUDs, the user knows what is happening to their data; the most used method is telling through notifications and toasts.

# if i haven't respond to some critical decisions, make the parts that won't be affected first.

# Reuse components to ensure consistent appearance.

# Avoid layout jumps.

# Prioritise in-place edit.

# General

- Suggest adding/removal/revise/reflow of fuctions if it is very necessary for UIUX improvements

- Reference conventional modern design guidelines.

- Present info architecture and content hierarchy, visual hierarchy and readability, using visual feedback, haptic feedback, notifications and all interactions, 

- Improve interactiveness using visual feedbacks, haptic feedbacks, notifications, etc.

- Make sure components and visual and design system are consistent and coherence and reused, also consistent USER FLOWS.

- Grids and component slignment.

**Check details and clarify with me along the way while you're working on this.**

**Documenting the plan in details, stop there when you finish and report to me, so I can hand the execution to another Agent.**

## Smooth Transition

```
- Use transitions and fadings etc., avoid cutting-jump.
```

## 

```
- If two components serve the same or similar purposes (e.g. both save something, both let edit, etc.), reuse existed component design, and adjust according to its specific purpose (e.g. primary, secondary, or tertiary).  
```

## Clean UI

```
- Brief and concise phrasing is preferred.
- Putting longer (over 50 characters, incl. spaces) descriptions/instructions into a quiestion mark button is preferred.
- Hidden menu/nav is preferred. A menu might shows up on hover to specific area / button clicked / certain scroll behavior or something else, depends on the design.
- For deeper navigation, a breadcrumb is preferred.
```



# Components



## Button and Information Hierarchy

```
- Primary, Secondary, Tertiary visual style is designed to (1) guide user, (2) let user focus on the more important info.
```



## Button Statuses

```
- In most cases, buttons are either: neutral (active), onHover, onClick/onPressed, or deactivated. these visual hints are crucial to a smooth and interactive Ux.
```



# User Input

```
- Depends on project scope, input suggestions should:
    - Support fuzzy suggestion.
    - Support cross-language fuzzy seggestion.
    - Suggest recent inputs first.
    - Suggest recent inputs and weigh based on recency.
- Depends on project scope, consider supporting + - * / in number-field.
- In most cases, if a user is allowed to add something, the user is allowed to do C/R/U/D of the input.
- In most cases, auto-save with a "XXX Saved" notification toast with a "Undo" btn; if "Undo" is clicked, another "Redo" toast is popped.  
```



## In-place editing / inline editing is preffered.



# Gestures and Sensory Feedbacks



## Touch Gestures



## Desktop Gestures


## Sensory Feedbacks



## Style

```
- Utilize semi-transparent backgound to create a sense of space for human experience.
```



## Haptics


## Let user knows what is happening. No silent fail, no silent overwrite, no silent deletion.
- Especially when something fails, notify user and let them decide how to deal with it.
- For data version conflict, generally default to the latest one, but also notify user and provide them a way to choose other versions.

## Interactive UI is preferred. Visual feedbacks for gestures such as during the drag is preferred.

## Debounce


## User-Facing Messeges

用正面表述, e. g. instead of "invalid", tell user "please provide valid URL of [valid sources]" or "invalid, please provide valid URL of [valid sources]".

