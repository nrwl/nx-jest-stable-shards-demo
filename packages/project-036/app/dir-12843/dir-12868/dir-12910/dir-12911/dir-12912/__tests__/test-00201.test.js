const leaf = require('./test-00201.leaf');

test('test-00201', () => {
  const expected = 'test-00201';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
