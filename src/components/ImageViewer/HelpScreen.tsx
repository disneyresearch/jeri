import * as React from 'react';
import styled from 'styled-components';

const HelpScreenDiv = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 2em 0;
  background-color: rgba(0, 0, 0, 0.8);
  line-height: 1.4em;
  color: white;
  table {
    width: 40em;
    margin: 0 auto;
  }
  h1 {
    font-size: 1em;
    margin: 0;
    padding: 0;
    line-height: 2em;
    text-align: center;
    padding-bottom: .5em;
  }
  th, td {
    text-align: left;
    padding: .4em 1em;
    vertical-align: top;
  }
  th {
    width: 10em;
  }
`;

export default () => {
  return (
    <HelpScreenDiv>
      <h1>Shortcuts</h1>
      <table>
        <tbody>
          <tr>
            <th>0-9</th>
            <td>Switch images</td>
          </tr>
          <tr>
            <th>Shift + 0-9</th>
            <td>Switch comparison (to for example reference or input)</td>
          </tr>
          <tr>
            <th>Shift + Arrows</th>
            <td>Navigate through the menu</td>
          </tr>
          <tr>
            <th>Shift + click</th>
            <td>Open a tab, and activate keyboard shortcuts for the row clicked</td>
          </tr>
          <tr>
            <th>e / E</th>
            <td>Increase / decrease <strong>e</strong>xposure</td>
          </tr>
          <tr>
            <th>r</th>
            <td>Reset exposure, positioning and zooming</td>
          </tr>
          <tr>
            <th>t</th>
            <td>Toggle between the Gamma 2.2 and the Pseudo ARRI K1S1 view transforms</td>
          </tr>
          <tr>
            <th>f</th>
            <td>Enter <strong>f</strong>ullscreen mode</td>
          </tr>
          <tr>
            <th>?</th>
            <td>Toggle this help screen</td>
          </tr>
        </tbody>
      </table>
    </HelpScreenDiv>
  );
};
