const leaf = require('./test-00011.leaf');

test('test-00011', () => {
  const expected: string = 'test-00011';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
