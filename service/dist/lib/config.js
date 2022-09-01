"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const fs_1 = __importDefault(require("fs"));
const yaml_1 = __importDefault(require("yaml"));
exports.config = {};
try {
    const commonConfig = yaml_1.default.parse(fs_1.default.readFileSync('./commonConfig.yaml', 'utf8'));
    const devConfig = yaml_1.default.parse(fs_1.default.readFileSync('./devConfig.yaml', 'utf8'));
    const prodConfig = yaml_1.default.parse(fs_1.default.readFileSync('./prodConfig.yaml', 'utf8'));
    process.env.NODE_ENV === 'development'
        ? (exports.config = Object.assign(commonConfig, devConfig))
        : (exports.config = Object.assign(commonConfig, prodConfig));
}
catch (err) {
    console.error(err);
}
