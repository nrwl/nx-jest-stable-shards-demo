const leaf = require('./test-00039.leaf');

test('test-00039', () => {
  const expected = 'test-00039';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
