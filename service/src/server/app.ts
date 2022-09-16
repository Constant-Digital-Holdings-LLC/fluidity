import express, { Application, Request, Response } from 'express';
import { RingBuffer } from 'ring-buffer-ts';

//blah
import { showMessage } from '../../../client/dist/public/js/lib/mylib';
showMessage();

console.log('test from server -- from TS');

const app: Application = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', async (req: Request, res: Response): Promise<Response> => {
    return res.status(200).send({
        message: 'Hello World!'
    });
});

try {
    app.listen(port, (): void => {
        console.log(`Connected successfully on port ${port}`);
    });
} catch (err) {
    console.error(err);
}

const ringBuffer = new RingBuffer<number>(5);
ringBuffer.add(1);
ringBuffer.add(2, 3);
ringBuffer.add(4, 5, 6);

console.log(ringBuffer.toArray());
