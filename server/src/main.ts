import { startApiServer } from './routes/api';

const port = Number(process.env.API_PORT ?? 3000);
startApiServer(port);