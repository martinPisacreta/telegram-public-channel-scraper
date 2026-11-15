import { Actor } from 'apify';
import { main } from './actor.mjs';

await Actor.main(async () => {
  await main(Actor);
});
