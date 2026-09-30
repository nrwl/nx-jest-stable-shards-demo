const leaf = require('./test-00009.leaf');

test('test-00009', () => {
  const expected: string = 'test-00009';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
