const leaf = require('./test-00041.leaf');

test('test-00041', () => {
  const expected = 'test-00041';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
