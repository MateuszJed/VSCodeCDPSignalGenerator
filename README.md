# Before running install.sh
 
This script requires `npm` and Node.js 20 or newer.
 
If `npm` is not found, install it first:
 
```bash
sudo apt install npm
```
 
Then install `nvm` to get Node 20 (the system npm comes with an older Node version that will cause errors):
 
```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```
 
Restart your terminal, then run:
 
```bash
nvm install 20
nvm use 20
sh install.sh
```
 