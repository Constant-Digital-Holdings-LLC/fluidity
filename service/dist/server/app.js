"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ring_buffer_ts_1 = require("ring-buffer-ts");
//blah
const mylib_1 = require("../../../client/dist/public/js/lib/mylib");
(0, mylib_1.showMessage)();
console.log('test from server -- from TS');
const app = (0, express_1.default)();
const port = 3000;
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.get('/', async (req, res) => {
    return res.status(200).send({
        message: 'Hello World!'
    });
});
try {
    app.listen(port, () => {
        console.log(`Connected successfully on port ${port}`);
    });
}
catch (err) {
    console.error(err);
}
const ringBuffer = new ring_buffer_ts_1.RingBuffer(5);
ringBuffer.add(1);
ringBuffer.add(2, 3);
ringBuffer.add(4, 5, 6);
console.log(ringBuffer.toArray());
