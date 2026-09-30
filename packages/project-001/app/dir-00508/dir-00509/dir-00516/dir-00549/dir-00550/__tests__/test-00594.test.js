const leaf = require('./test-00594.leaf');

test('test-00594', () => {
  const expected = 'test-00594';
  burn(1530);
  expect(leaf.value).toBe(expected);
});
