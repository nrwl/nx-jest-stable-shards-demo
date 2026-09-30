const leaf = require('./test-00474.leaf');

test('test-00474', () => {
  const expected = 'test-00474';
  burn(7743);
  expect(leaf.value).toBe(expected);
});
