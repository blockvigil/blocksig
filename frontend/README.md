# BlockSig Frontend

## Development

- `npm install`

- `npm run dev`

- You can open the dist folder in a browser or serve using nginx or a basic server.

## To deploy

### S3

- See .env.example to fill in S3 details.

- `npm run deploy`


## Fleek

- Setup environment vars for `API_PREFIX` and `STRIPE_KEY` if necessary

- Build command: `npm install && npm run build`

- Publish directory: `dist`

- It's should be setup to automatically deploy on each push.

- [More instructions](https://docs.fleek.co/hosting/site-deployment/)
