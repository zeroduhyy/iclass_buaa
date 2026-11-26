import { startApiServer } from './routes/api';
import { startAutoSign } from './services/autoSignService';

const port = Number(process.env.API_PORT ?? 3000);
startApiServer(port);
startAutoSign();
