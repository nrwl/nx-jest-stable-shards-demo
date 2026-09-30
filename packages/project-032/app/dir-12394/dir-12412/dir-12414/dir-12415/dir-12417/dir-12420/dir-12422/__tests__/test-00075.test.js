const leaf = require('./test-00075.leaf');

test('test-00075', () => {
  const expected = 'test-00075';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
