import { registerRootComponent } from 'expo';

// Background tasks must be defined before the app mounts: the OS can wake the app with no screen to run them.
import './src/place/placeTask';
import './src/jobs/periodicTask';
import App from './App';

registerRootComponent(App);
