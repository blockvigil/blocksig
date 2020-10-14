# BlockSig Backend

## Interacting with the Ethereum components

- Setup [EthVigil account](https://EthVigil.com/docs) or [MaticVigil](https://MaticVigil.com/docs)

- Deploy `BlockSig.sol` from CLI or Web UI

- See `config/default.json` and create another file like `${NODE_ENV}.json` by copying over contract address and API KEY (secret)


## Running the server

- recommended NodeJS (v10.x) for HummusJS binary support

- `npm install`

- `npm start`

- [More instructions on setting up Space Daemon](https://docs.fleek.co/space-daemon/getting-started/)

- [Additionally setup Lotus](https://docs.filecoin.io/get-started/lotus/installation/) and [Powergate](https://docs.textile.io/powergate/testnet/) for Filecoin Testnet integration

## Setup webhook

- Use the MaticVigil or EthVigil [CLI](https://ethvigil.com/docs/cli_onboarding/#adding-integrations) or [Web UI](https://ethvigil.com/docs/web_onboarding/#adding-integrations) to register for all events on your contract to `https://server.dev/hook`


> Tip: Open a SSH tunnel or use [ngrok](https://ngrok.io/) to open up the server running at 5000 as a publicly reachable https URL to register the hook
