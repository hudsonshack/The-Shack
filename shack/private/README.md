# private/ (gitignored)

Raw data that must never be committed: transaction lists, email bodies, grades, client contacts.
Each agent uses its own subfolder (`private/ledger-fi/`, ...). In cloud cycles this folder starts empty every time.
Only this README is tracked. `scripts/validate.py` blocks any other file here from being committed.
