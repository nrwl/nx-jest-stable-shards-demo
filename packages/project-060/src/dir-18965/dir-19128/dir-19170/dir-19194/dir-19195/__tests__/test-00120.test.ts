const leaf = require('./test-00120.leaf');

test('test-00120', () => {
  const expected: string = 'test-00120';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
