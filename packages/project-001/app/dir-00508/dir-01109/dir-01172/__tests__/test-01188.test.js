const leaf = require('./test-01188.leaf');

test('test-01188', () => {
  const expected = 'test-01188';
  burn(1717);
  expect(leaf.value).toBe(expected);
});
