// The agent's readings come from other programs' output and from counters;
// these are the parts that turn those into figures.

import { describe, expect, it } from 'vitest';
import { counterDelta, cpuShares, firstFileInTar, parseNetstat, parseNvidiaSmi, parseProcNetDev } from '../src/agent-lib.js';

describe('agent readings', () => {
  it('reads graphics cards from nvidia-smi, leaving gaps where a card says nothing', () => {
    const out = 'NVIDIA GeForce RTX 4080 SUPER, 37, 1358, 16376, 36, 13.23, 0\r\nSome Laptop Card, 5, 100, 4096, [N/A], [N/A], [N/A]\r\n';
    expect(parseNvidiaSmi(out)).toEqual([
      { name: 'NVIDIA GeForce RTX 4080 SUPER', util: 0.37, memUsed: 1358 * 1048576, memTotal: 16376 * 1048576, temp: 36, power: 13.23, fan: 0 },
      { name: 'Some Laptop Card', util: 0.05, memUsed: 100 * 1048576, memTotal: 4096 * 1048576, temp: null, power: null, fan: null },
    ]);
    expect(parseNvidiaSmi('')).toEqual([]);
  });

  it("reads Windows' network totals whatever language the labels are in", () => {
    const english = 'Interface Statistics\r\n\r\n                           Received            Sent\r\n\r\nBytes                    1428763468       168830980\r\nUnicast packets             1186250          731850\r\n';
    expect(parseNetstat(english)).toEqual({ rx: 1428763468, tx: 168830980 });
    expect(parseNetstat('Schnittstellenstatistik\r\n\r\n                 Empfangen      Gesendet\r\n\r\nBytes               12             34\r\n')).toEqual({ rx: 12, tx: 34 });
    expect(parseNetstat('nothing useful')).toBeNull();
  });

  it("reads Linux's network totals without loopback or Docker's own interfaces", () => {
    const text = [
      'Inter-|   Receive                                                |  Transmit',
      ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
      '    lo: 500 1 0 0 0 0 0 0 500 1 0 0 0 0 0 0',
      '  eth0: 1000 1 0 0 0 0 0 0 2000 1 0 0 0 0 0 0',
      'docker0: 70 1 0 0 0 0 0 0 80 1 0 0 0 0 0 0',
      'veth12ab: 7 1 0 0 0 0 0 0 8 1 0 0 0 0 0 0',
      ' wlan0: 10 1 0 0 0 0 0 0 20 1 0 0 0 0 0 0',
    ].join('\n');
    expect(parseProcNetDev(text)).toEqual({ rx: 1010, tx: 2020 });
  });

  it('works out how busy each core was between two readings', () => {
    const before = [{ idle: 100, total: 200 }, { idle: 50, total: 100 }];
    const after = [{ idle: 150, total: 300 }, { idle: 50, total: 200 }];
    expect(cpuShares(before, after)).toEqual({ cpu: 0.75, perCore: [0.5, 1] });
    // Nothing to compare with yet.
    expect(cpuShares(null, after)).toEqual({ cpu: 0, perCore: [0, 0] });
  });

  it('follows a counter that starts again from zero', () => {
    expect(counterDelta(100, 250, 2 ** 32)).toBe(150);
    expect(counterDelta(2 ** 32 - 10, 5, 2 ** 32)).toBe(15);
  });

  it('takes the file out of the archive Docker wraps it in', () => {
    const body = Buffer.from('hello sqlite');
    const header = Buffer.alloc(512);
    header.write('database.sqlite', 0);
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('0', 156);
    const tar = Buffer.concat([header, body, Buffer.alloc(512 - body.length), Buffer.alloc(1024)]);
    expect(firstFileInTar(tar)?.toString()).toBe('hello sqlite');
    expect(firstFileInTar(Buffer.alloc(1024))).toBeNull();
  });
});
